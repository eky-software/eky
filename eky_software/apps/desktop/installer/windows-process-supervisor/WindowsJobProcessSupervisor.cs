using System.Diagnostics;

namespace Eky.WindowsProcessSupervisor;

internal sealed class WindowsJobProcessSupervisor(
    Stopwatch stopwatch,
    SafeEvidenceWriter evidence,
    Func<SupervisorRequest, WindowsJob, CancellationToken, SuspendedWindowsProcess>? createProcess = null,
    Func<SuspendedWindowsProcess, bool>? observeRootExit = null
)
{
    private const int WaitSliceMilliseconds = 100;
    private const int HeartbeatMilliseconds = 60_000;

    internal Task LateCreationRelease { get; private set; } = Task.CompletedTask;

    internal SupervisorOutcome Run(SupervisorRequest request)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new SupervisorFailure("platformUnsupported");
        }

        evidence.Write("jobCreated", "started");
        using var job = WindowsJob.Create();
        evidence.Write("jobCreated", "completed");
        evidence.Write("jobHandlePolicy", "completed", "nonInheritableKillOnClose");

        evidence.Write("hostStarted", "started");
        using var cancellation = new CancellationTokenSource();
        var creation = Task.Run(() =>
            createProcess is null
                ? SuspendedWindowsProcess.Start(request, job, cancellation.Token)
                : createProcess(request, job, cancellation.Token));
        var workDeadline = request.TimeoutMilliseconds - request.CleanupReserveMilliseconds;
        if (!WaitForCreation(creation, workDeadline))
        {
            evidence.Write("deadlineExceeded", "failed", errorCode: "deadlineExceeded");
            cancellation.Cancel();
            return CleanupPendingCreation(job, creation, request);
        }
        SuspendedWindowsProcess child;
        try
        {
            child = creation.GetAwaiter().GetResult();
        }
        catch (Exception error)
        {
            var failure = error as SupervisorFailure ?? new SupervisorFailure("processStartFailed");
            evidence.Write(
                "hostStarted",
                "failed",
                errorCode: failure.ErrorCode,
                win32ErrorCode: failure.Win32ErrorCode
            );
            return FailAfterCleanup(job, request, failure.ErrorCode, null, null) with
            {
                ProcessWin32ErrorCode = failure.Win32ErrorCode,
            };
        }

        using (child)
        {
            evidence.Write("hostAssigned", "completed");
            if (stopwatch.ElapsedMilliseconds >= workDeadline)
            {
                evidence.Write("deadlineExceeded", "failed", errorCode: "deadlineExceeded");
                return FailAfterCleanup(job, request, "deadlineExceeded", null, child);
            }
            try
            {
                child.Resume();
            }
            catch (SupervisorFailure failure)
            {
                evidence.Write(
                    "hostStarted",
                    "failed",
                    errorCode: failure.ErrorCode,
                    win32ErrorCode: failure.Win32ErrorCode
                );
                return FailAfterCleanup(job, request, failure.ErrorCode, null, child) with
                {
                    ProcessWin32ErrorCode = failure.Win32ErrorCode,
                };
            }

            evidence.Write("hostStarted", "completed");
            evidence.Write("waitStarted", "started");
            return WaitForTerminalProcessState(job, child, request);
        }
    }

    private bool WaitForCreation(Task<SuspendedWindowsProcess> creation, long deadline)
    {
        var remaining = deadline - stopwatch.ElapsedMilliseconds;
        if (!creation.IsCompleted && remaining > 0)
            Task.WaitAny([creation], (int)Math.Min(int.MaxValue, remaining));
        return creation.IsCompleted;
    }

    private SupervisorOutcome CleanupPendingCreation(
        WindowsJob job, Task<SuspendedWindowsProcess> creation, SupervisorRequest request)
    {
        evidence.Write("cleanupStarted", "started");
        // A zero Job count is not absence while the native call can still create a suspended member.
        if (!WaitForCreation(creation, request.TimeoutMilliseconds))
        {
            // This owner receives late handles without resuming the failed run or changing its result.
            LateCreationRelease = creation.ContinueWith(completed =>
            {
                if (completed.Status == TaskStatus.RanToCompletion) completed.Result.Dispose();
                else _ = completed.Exception;
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            try { job.Terminate(); }
            catch (SupervisorFailure failure)
            {
                evidence.Write("cleanupCompleted", "failed", errorCode: "cleanupFailed",
                    win32ErrorCode: failure.Win32ErrorCode);
                return SupervisorOutcome.Failed("deadlineExceeded", "cleanupFailed", false,
                    cleanupWin32ErrorCode: failure.Win32ErrorCode);
            }
            evidence.Write("cleanupCompleted", "failed", errorCode: "cleanupUnverified");
            // The attribute retains the Job through creation; final close kills any late suspended member.
            // Host exit also closes the Job if native creation never returns. Absence is not yet proven.
            return SupervisorOutcome.Failed("deadlineExceeded", "cleanupUnverified", false);
        }
        SuspendedWindowsProcess? child = null;
        try
        {
            child = creation.GetAwaiter().GetResult();
        }
        catch (Exception)
        {
            // Creation cancellation/failure does not replace the original deadline.
        }
        using (child)
            return FailAfterCleanup(job, request, "deadlineExceeded", null, child,
                cleanupStarted: true);
    }

    private SupervisorOutcome WaitForTerminalProcessState(
        WindowsJob job,
        SuspendedWindowsProcess child,
        SupervisorRequest request
    )
    {
        var workDeadline = request.TimeoutMilliseconds - request.CleanupReserveMilliseconds;
        var nextHeartbeat = HeartbeatMilliseconds;
        var descendantObserved = false;
        var rootExited = false;
        int? childExitCode = null;

        while (stopwatch.ElapsedMilliseconds < workDeadline)
        {
            var activeProcessCount = job.GetActiveProcessCount();
            if (!descendantObserved && activeProcessCount > 1)
            {
                descendantObserved = true;
                evidence.Write("processTreeObserved", "completed", "descendantObserved");
            }

            if (!rootExited && (observeRootExit?.Invoke(child) ?? child.Wait(0)))
            {
                rootExited = true;
                childExitCode = child.GetExitCode();
                evidence.Write(
                    "hostExited",
                    childExitCode == 0 ? "completed" : "failed",
                    childExitCode == 0 ? "hostExited" : null,
                    childExitCode == 0 ? null : "processExitFailed"
                );
            }

            // Job accounting and the process handle are separate observations during termination.
            if (activeProcessCount == 0 && rootExited)
            {
                evidence.Write("waitStarted", "completed");
                evidence.Write("processTreeAbsent", "completed");
                if (childExitCode != 0)
                {
                    return SupervisorOutcome.Failed(
                        "processExitFailed",
                        "notRequired",
                        true,
                        childExitCode
                    );
                }

                evidence.Write("workerResultValidated", "started");
                var workerResult = WorkerTerminalResultReader.Validate(request);
                evidence.Write(
                    "workerResultValidated",
                    workerResult.IsSuccessful ? "completed" : "failed",
                    workerResult.IsSuccessful ? workerResult.ResultCode : null,
                    workerResult.IsSuccessful ? null : workerResult.ResultCode
                );
                return workerResult.IsSuccessful
                    ? SupervisorOutcome.Completed(childExitCode!.Value)
                    : SupervisorOutcome.Failed(
                        "processCompleted",
                        "notRequired",
                        true,
                        childExitCode,
                        workerResult.ResultCode
                    );
            }

            if (rootExited && childExitCode != 0)
            {
                return FailAfterCleanup(
                    job,
                    request,
                    "processExitFailed",
                    childExitCode,
                    child
                );
            }

            if (stopwatch.ElapsedMilliseconds >= nextHeartbeat)
            {
                evidence.Write("waitHeartbeat", "heartbeat");
                nextHeartbeat += HeartbeatMilliseconds;
            }

            var remaining = workDeadline - stopwatch.ElapsedMilliseconds;
            if (remaining <= 0)
            {
                break;
            }
            var waitMilliseconds = (int)Math.Min(WaitSliceMilliseconds, remaining);
            if (rootExited)
            {
                job.Wait(waitMilliseconds);
            }
            else
            {
                child.Wait(waitMilliseconds);
            }
        }

        evidence.Write("deadlineExceeded", "failed", errorCode: "deadlineExceeded");
        return FailAfterCleanup(job, request, "deadlineExceeded", childExitCode, child);
    }

    private SupervisorOutcome FailAfterCleanup(
        WindowsJob job,
        SupervisorRequest request,
        string failureCode,
        int? childExitCode,
        SuspendedWindowsProcess? child,
        bool cleanupStarted = false
    )
    {
        if (!cleanupStarted) evidence.Write("cleanupStarted", "started");
        try
        {
            if (job.GetActiveProcessCount() == 0 && (child is null || child.Wait(0)))
            {
                evidence.Write("cleanupCompleted", "completed");
                evidence.Write("processTreeAbsent", "completed");
                return SupervisorOutcome.Failed(
                    failureCode,
                    "notRequired",
                    true,
                    childExitCode
                );
            }
            job.Terminate();
            return AwaitCleanup(job, request, failureCode, childExitCode, child);
        }
        catch (SupervisorFailure cleanupFailure)
        {
            evidence.Write(
                "cleanupCompleted",
                "failed",
                errorCode: "cleanupFailed",
                win32ErrorCode: cleanupFailure.Win32ErrorCode
            );
            return SupervisorOutcome.Failed(
                failureCode,
                "cleanupFailed",
                false,
                childExitCode,
                cleanupWin32ErrorCode: cleanupFailure.Win32ErrorCode
            );
        }
    }

    private SupervisorOutcome AwaitCleanup(
        WindowsJob job,
        SupervisorRequest request,
        string failureCode,
        int? childExitCode,
        SuspendedWindowsProcess? child
    )
    {
        while (stopwatch.ElapsedMilliseconds < request.TimeoutMilliseconds)
        {
            if (job.GetActiveProcessCount() == 0 && (child is null || child.Wait(0)))
            {
                evidence.Write("cleanupCompleted", "completed");
                evidence.Write("processTreeAbsent", "completed");
                return SupervisorOutcome.Failed(
                    failureCode,
                    "processTreeAbsent",
                    true,
                    childExitCode
                );
            }

            var remaining = request.TimeoutMilliseconds - stopwatch.ElapsedMilliseconds;
            if (remaining <= 0)
            {
                break;
            }
            if (child is not null && !child.Wait(0))
                child.Wait((int)Math.Min(WaitSliceMilliseconds, remaining));
            else
                job.Wait((int)Math.Min(WaitSliceMilliseconds, remaining));
        }

        evidence.Write("cleanupCompleted", "failed", errorCode: "cleanupFailed");
        return SupervisorOutcome.Failed(
            failureCode,
            "cleanupFailed",
            false,
            childExitCode
        );
    }
}
