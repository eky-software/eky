using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

internal static class LateProcessCreationContract
{
    internal static readonly HashSet<string> Modes =
        ["nativeAfterTerminal", "handlesAfterTerminal", "failureAfterTerminal"];

    internal static int RunPendingCommand(string[] arguments)
    {
        using var releaseExit = new ManualResetEventSlim();
        FileSystemWatcher? watcher = null;
        string? markerPath = null;
        string? releasePath = null;
        SupervisorRequest? validatedRequest = null;
        var nativeBoundaryEntered = 0;
        var creationReturned = 0;
        var executeReturned = false;
        try
        {
            var exitCode = SupervisorProgram.Run(arguments, (request, stopwatch, evidence) =>
            {
                validatedRequest = request;
                var root = Path.Combine(request.WorkingDirectory, request.RunNonce);
                Directory.CreateDirectory(root);
                markerPath = Path.Combine(root, "command.ready.json");
                releasePath = Path.Combine(root, "command.release");
                watcher = new FileSystemWatcher(root, "command.release");
                watcher.Created += (_, _) => releaseExit.Set();
                watcher.EnableRaisingEvents = true;
                var supervisor = new WindowsJobProcessSupervisor(stopwatch, evidence,
                    (input, job, cancellation) =>
                    {
                        try
                        {
                            return SuspendedWindowsProcess.Start(input, job, cancellation, phase =>
                            {
                                if (phase != "nativeCallStarted") return;
                                Volatile.Write(ref nativeBoundaryEntered, 1);
                                // Retain the actual Job attribute across result write and command exit.
                                // This stalls the boundary, not the Windows kernel call itself.
                                using var neverReleased = new ManualResetEvent(false);
                                neverReleased.WaitOne();
                            });
                        }
                        finally { Volatile.Write(ref creationReturned, 1); }
                    });
                var outcome = supervisor.Run(request);
                executeReturned = true;
                return outcome;
            });
            if (validatedRequest is null || markerPath is null || releasePath is null ||
                Volatile.Read(ref nativeBoundaryEntered) != 1 ||
                Volatile.Read(ref creationReturned) != 0 || !executeReturned || exitCode != 1 ||
                !File.Exists(validatedRequest.ResultPath)) return 65;
            File.WriteAllText(markerPath + ".next", JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                runNonce = validatedRequest.RunNonce,
                role = "command",
                processId = Environment.ProcessId,
                executeReturned,
                resultWritten = true,
                creationStillPending = Volatile.Read(ref creationReturned) == 0,
            }));
            File.Move(markerPath + ".next", markerPath);
            // Only this contract entrypoint pauses after the real command result, not the supervisor.
            if (!File.Exists(releasePath) && !releaseExit.Wait(5_000)) return 66;
            return exitCode;
        }
        finally
        {
            watcher?.Dispose();
        }
    }

    internal static SupervisorOutcome Run(
        string mode, SupervisorRequest request, Stopwatch stopwatch, SafeEvidenceWriter evidence)
    {
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        SuspendedWindowsProcess? lateChild = null;
        SafeProcessHandle? pinnedProcess = null;
        uint? countBeforeNative = null;
        var supervisor = new WindowsJobProcessSupervisor(stopwatch, evidence,
            (input, job, cancellation) =>
            {
                lateChild = SuspendedWindowsProcess.Start(input, job, cancellation, phase =>
                {
                    if (mode != "nativeAfterTerminal" || phase != "nativeCallStarted") return;
                    countBeforeNative = job.GetActiveProcessCount();
                    entered.Set();
                    release.Wait();
                });
                if (!DuplicateHandle(new IntPtr(-1), lateChild.Process, new IntPtr(-1),
                    out pinnedProcess, 0, false, 2))
                    throw new InvalidOperationException("contractPinFailed");
                if (mode != "nativeAfterTerminal")
                {
                    entered.Set();
                    release.Wait();
                }
                if (mode == "failureAfterTerminal")
                {
                    lateChild.Dispose();
                    throw new InvalidOperationException("contractLateFailure");
                }
                return lateChild;
            });

        SupervisorOutcome outcome;
        try
        {
            outcome = supervisor.Run(request);
            if (!entered.IsSet || outcome.ProcessResultCode != "deadlineExceeded" ||
                outcome.CleanupResultCode != "cleanupUnverified" || outcome.ProcessTreeAbsent)
                throw new InvalidOperationException("contractTerminalInvalid");
        }
        finally
        {
            // Only the test releases its injected barrier, and only after Run has returned.
            release.Set();
        }

        if (!supervisor.LateCreationRelease.Wait(3_000))
            throw new InvalidOperationException("contractLateReleaseMissing");
        using (pinnedProcess)
        {
            if (lateChild is null || pinnedProcess is null || !lateChild.HandlesClosed ||
                NativeMethods.WaitForSingleObject(pinnedProcess, 3_000) != NativeMethods.WaitObject0)
                throw new InvalidOperationException("contractLateExitMissing");
            File.WriteAllText(Path.Combine(request.WorkingDirectory, "late-creation.json"),
                JsonSerializer.Serialize(new
                {
                    terminalBeforeRelease = true,
                    countBeforeNative,
                    lateHandlesClosed = lateChild.HandlesClosed,
                    exactLateProcessExited = true,
                    originalAbsenceUnverified = !outcome.ProcessTreeAbsent,
                }));
        }
        return outcome;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess, SafeProcessHandle sourceHandle, IntPtr targetProcess,
        out SafeProcessHandle targetHandle, uint access,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint options);
}
