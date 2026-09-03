using System.Diagnostics;

namespace Eky.WindowsProcessSupervisor;

internal sealed class WindowsJobProcessSupervisor(
    Stopwatch stopwatch,
    SafeEvidenceWriter evidence
)
{
    private const int WaitSliceMilliseconds = 100;
    private const int HeartbeatMilliseconds = 60_000;

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
        SuspendedWindowsProcess child;
        try
        {
            child = SuspendedWindowsProcess.Start(request);
        }
        catch (SupervisorFailure failure)
        {
            evidence.Write(
                "hostStarted",
                "failed",
                errorCode: failure.ErrorCode,
                win32ErrorCode: failure.Win32ErrorCode
            );
            return SupervisorOutcome.Failed(
                failure.ErrorCode,
                "notRequired",
                true,
                processWin32ErrorCode: failure.Win32ErrorCode
            );
        }

        using (child)
        {
            var assigned = false;
            try
            {
                job.Assign(child.Process);
                assigned = true;
                evidence.Write("hostAssigned", "completed");
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
                return CleanupStartFailure(
                    job,
                    child,
                    request,
                    assigned,
                    failure
                );
            }

            evidence.Write("hostStarted", "completed");
            evidence.Write("waitStarted", "started");
            return WaitForTerminalProcessState(job, child, request);
        }
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

            if (!rootExited && child.Wait(0))
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

            if (activeProcessCount == 0)
            {
                if (!rootExited)
                {
                    rootExited = child.Wait(0);
                    if (!rootExited)
                    {
                        throw new SupervisorFailure("processStateInvalid");
                    }
                    childExitCode = child.GetExitCode();
                    evidence.Write(
                        "hostExited",
                        childExitCode == 0 ? "completed" : "failed",
                        childExitCode == 0 ? "hostExited" : null,
                        childExitCode == 0 ? null : "processExitFailed"
                    );
                }

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
                    ? SupervisorOutcome.Completed(childExitCode.Value)
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
                    childExitCode
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
        return FailAfterCleanup(job, request, "deadlineExceeded", childExitCode);
    }

    private SupervisorOutcome CleanupStartFailure(
        WindowsJob job,
        SuspendedWindowsProcess child,
        SupervisorRequest request,
        bool assigned,
        SupervisorFailure failure
    )
    {
        evidence.Write("cleanupStarted", "started");
        try
        {
            if (assigned)
            {
                job.Terminate();
                return AwaitCleanup(
                    job,
                    request,
                    failure.ErrorCode,
                    null,
                    failure.Win32ErrorCode
                );
            }

            child.TerminateDirectProcess();
            var remaining = request.TimeoutMilliseconds - stopwatch.ElapsedMilliseconds;
            if (remaining > 0 && child.Wait((int)Math.Min(int.MaxValue, remaining)))
            {
                evidence.Write("cleanupCompleted", "completed");
                evidence.Write("processTreeAbsent", "completed");
                return SupervisorOutcome.Failed(
                    failure.ErrorCode,
                    "processTreeAbsent",
                    true,
                    processWin32ErrorCode: failure.Win32ErrorCode
                );
            }
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
                failure.ErrorCode,
                "cleanupFailed",
                false,
                processWin32ErrorCode: failure.Win32ErrorCode,
                cleanupWin32ErrorCode: cleanupFailure.Win32ErrorCode
            );
        }

        evidence.Write("cleanupCompleted", "failed", errorCode: "cleanupFailed");
        return SupervisorOutcome.Failed(
            failure.ErrorCode,
            "cleanupFailed",
            false,
            processWin32ErrorCode: failure.Win32ErrorCode
        );
    }

    private SupervisorOutcome FailAfterCleanup(
        WindowsJob job,
        SupervisorRequest request,
        string failureCode,
        int? childExitCode
    )
    {
        evidence.Write("cleanupStarted", "started");
        try
        {
            if (job.GetActiveProcessCount() == 0)
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
            return AwaitCleanup(job, request, failureCode, childExitCode);
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
        int? processWin32ErrorCode = null
    )
    {
        while (stopwatch.ElapsedMilliseconds < request.TimeoutMilliseconds)
        {
            if (job.GetActiveProcessCount() == 0)
            {
                evidence.Write("cleanupCompleted", "completed");
                evidence.Write("processTreeAbsent", "completed");
                return SupervisorOutcome.Failed(
                    failureCode,
                    "processTreeAbsent",
                    true,
                    childExitCode,
                    processWin32ErrorCode: processWin32ErrorCode
                );
            }

            var remaining = request.TimeoutMilliseconds - stopwatch.ElapsedMilliseconds;
            if (remaining <= 0)
            {
                break;
            }
            job.Wait((int)Math.Min(WaitSliceMilliseconds, remaining));
        }

        evidence.Write("cleanupCompleted", "failed", errorCode: "cleanupFailed");
        return SupervisorOutcome.Failed(
            failureCode,
            "cleanupFailed",
            false,
            childExitCode,
            processWin32ErrorCode: processWin32ErrorCode
        );
    }
}
