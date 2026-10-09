using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

internal static class ProcessBoundaryContract
{
    private const int RequiredEmptyJobObservations = 2;

    internal static readonly HashSet<string> Modes =
    [
        "atomicMembership", "creationCancelled", "creationLate", "creationPending",
        "creationFailure", "creationUnexpectedFailure", "exitObservationLate",
        "exitObservationEarlyReceipt",
    ];

    internal static SupervisorOutcome Run(
        string mode, SupervisorRequest request, Stopwatch stopwatch, SafeEvidenceWriter evidence)
    {
        WindowsJob? observedJob = null;
        var emptyJobObservations = 0;
        var earlyReceiptInjected = false;
        var delayExitObservation = mode is "exitObservationLate" or "exitObservationEarlyReceipt";
        var supervisor = new WindowsJobProcessSupervisor(
            stopwatch, evidence,
            (input, job, cancellation) =>
            {
                observedJob = job;
                if (mode == "creationCancelled")
                {
                    WriteBoundary(input, new { boundary = "creationEntered" });
                    cancellation.WaitHandle.WaitOne();
                    return SuspendedWindowsProcess.Start(input, job, cancellation);
                }
                if (mode == "creationFailure")
                    throw new SupervisorFailure("processStartFailed", 2);

                var child = SuspendedWindowsProcess.Start(input, job, cancellation);
                if (delayExitObservation) return child;
                var activeProcessCount = job.GetActiveProcessCount();
                var processId = GetProcessId(child.Process);
                WriteBoundary(input, new { boundary = "createdSuspended", activeProcessCount, processId });
                if (mode == "creationUnexpectedFailure")
                {
                    child.Dispose();
                    throw new InvalidOperationException("contractCreationFailure");
                }
                if (mode == "creationLate") cancellation.WaitHandle.WaitOne();
                if (mode == "creationPending")
                {
                    // The real supervisor must terminalize even when native creation never returns.
                    using var neverReturns = new ManualResetEvent(false);
                    neverReturns.WaitOne();
                }
                return child;
            },
            child =>
            {
                var exited = child.Wait(0);
                if (!delayExitObservation || !exited) return exited;
                var activeProcessCount = observedJob!.GetActiveProcessCount();
                if (mode == "exitObservationEarlyReceipt" && exited && !earlyReceiptInjected)
                {
                    earlyReceiptInjected = true;
                    activeProcessCount = 1;
                }
                if (activeProcessCount != 0) return false;
                // The supervisor reads Job accounting before invoking this observer.
                // A second empty observation guarantees its next loop sees the same boundary.
                if (emptyJobObservations < RequiredEmptyJobObservations)
                {
                    emptyJobObservations++;
                    WriteBoundary(request, new {
                        boundary = "jobEmptyBeforeExitObserved", exitObservedLater = false,
                        earlyReceiptDeferred = earlyReceiptInjected,
                    });
                    return false;
                }
                WriteBoundary(request, new {
                    boundary = "jobEmptyBeforeExitObserved", exitObservedLater = true,
                    earlyReceiptDeferred = earlyReceiptInjected,
                });
                return true;
            }
        );
        return supervisor.Run(request);
    }

    private static void WriteBoundary<T>(SupervisorRequest request, T boundary) =>
        File.WriteAllText(Path.Combine(request.WorkingDirectory, "process-boundary.json"),
            JsonSerializer.Serialize(boundary));

    [DllImport("kernel32.dll")]
    private static extern uint GetProcessId(SafeProcessHandle process);
}
