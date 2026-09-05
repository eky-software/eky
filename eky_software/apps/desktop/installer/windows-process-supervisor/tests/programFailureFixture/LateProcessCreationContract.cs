using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

internal static class LateProcessCreationContract
{
    internal static readonly HashSet<string> Modes =
        ["nativeAfterTerminal", "handlesAfterTerminal", "failureAfterTerminal"];

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
