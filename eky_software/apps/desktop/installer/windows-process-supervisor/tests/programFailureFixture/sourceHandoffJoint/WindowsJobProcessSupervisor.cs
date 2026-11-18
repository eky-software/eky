using System.Diagnostics;

namespace Eky.WindowsProcessSupervisor;

internal sealed class WindowsJobProcessSupervisor(
    Stopwatch stopwatch,
    SafeEvidenceWriter evidence,
    Func<SupervisorRequest, WindowsJob, CancellationToken, SuspendedWindowsProcess>? createProcess = null,
    Func<SuspendedWindowsProcess, bool>? observeRootExit = null,
    Func<SupervisorRequest, WorkerTerminalResultValidation>? validateWorkerResult = null,
    ISupervisorDeadline? deadline = null,
    Func<WindowsJob, WorkspaceMsiMembership>? observeMsiActivity = null,
    SourceHandoffContext? sourceContext = null
)
{
    private const int WaitSliceMilliseconds = 100;
    private const int HeartbeatMilliseconds = 60_000;
    private readonly ISupervisorDeadline supervisorDeadline =
        deadline ?? new StopwatchSupervisorDeadline(stopwatch);

    private SourceHandoffPrototype? source;
    private bool sourceWorkUnsettledOnReturn;
    private SupervisorOutcome? originalOwnerOutcome;
    internal object? SourceProof => source?.Proof(originalOwnerOutcome);
    private bool SourceAbsenceVerified => source is null || (source.RequiredWorkSettled && source.SourceSignalled);

    internal Task LateCreationRelease { get; private set; } = Task.CompletedTask;

    internal SupervisorOutcome Run(SupervisorRequest request)
    {
        var outcome = RunCore(request);
        originalOwnerOutcome = outcome;
        return outcome with
        {
            Status = source?.ReleaseFailed == true ? "failed" : outcome.Status,
            ProcessResultCode = source?.ReleaseFailed == true && outcome.Status != "failed" ? "processStateInvalid" : outcome.ProcessResultCode,
            WorkerResultCode = source?.ReleaseFailed == true && outcome.Status != "failed" ? "notChecked" : outcome.WorkerResultCode,
            CleanupResultCode = source?.ReleaseFailed == true ? "cleanupFailed" : outcome.CleanupResultCode,
            ProcessTreeAbsent = source?.ReleaseFailed == true ? false : outcome.ProcessTreeAbsent,
            HostOperationsCompleted = outcome.HostOperationsCompleted && !sourceWorkUnsettledOnReturn && source?.ReleaseFailed != true,
        };
    }

    private SupervisorOutcome RunCore(SupervisorRequest request)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new SupervisorFailure("platformUnsupported");
        }

        evidence.Write("jobCreated", "started");
        using var job = WindowsJob.Create();
        try
        {
        source = sourceContext is null ? null : new SourceHandoffPrototype(sourceContext, job,
            () => supervisorDeadline.ElapsedMilliseconds);
        sourceContext?.Proof.RetirementRace?.StartPrecondition(() => source is { AdmissionClosed: false });
        evidence.Write("jobCreated", "completed");
        evidence.Write("jobHandlePolicy", "completed", "nonInheritableKillOnClose");

        var workDeadline = request.TimeoutMilliseconds - request.CleanupReserveMilliseconds;
        if (source is not null)
        {
            var admission = source.BeginRootAdmission();
            if (!supervisorDeadline.WaitForTask(admission, workDeadline))
                return FailAfterCleanup(job, request, "deadlineExceeded", null, null);
            source.SettleRootAdmission();
            if (!source.RootAdmitted)
                return SupervisorOutcome.Failed("processStateInvalid", "notRequired", true);
            if (supervisorDeadline.ElapsedMilliseconds >= workDeadline)
                return FailAfterCleanup(job, request, "deadlineExceeded", null, null);
        }

        evidence.Write("hostStarted", "started");
        using var cancellation = new CancellationTokenSource();
        var creation = Task.Run(() =>
            createProcess is null
                ? SuspendedWindowsProcess.Start(request, job, cancellation.Token)
                : createProcess(request, job, cancellation.Token));
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
            if (supervisorDeadline.ElapsedMilliseconds >= workDeadline)
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
        finally
        {
            sourceContext?.Proof.RetirementRace?.ReleaseOnUnwind();
            if (source is not null)
            {
                try
                {
                    source.CloseAdmission();
                    sourceWorkUnsettledOnReturn = !source.RequiredWorkSettled;
                    if (SourceAbsenceVerified) source.ReleaseSettledHandles();
                    else LateCreationRelease = Task.WhenAll(LateCreationRelease, source.ReleaseLateWork());
                }
                catch (Exception error)
                {
                    sourceContext!.Proof.ObserveCleanup(error);
                    sourceWorkUnsettledOnReturn = true;
                    LateCreationRelease = Task.WhenAll(LateCreationRelease, source.ReleaseLateWork());
                }
            }
        }
    }

    private bool WaitForCreation(Task<SuspendedWindowsProcess> creation, long deadline) =>
        supervisorDeadline.WaitForTask(creation, deadline);

    private SupervisorOutcome CleanupPendingCreation(
        WindowsJob job, Task<SuspendedWindowsProcess> creation, SupervisorRequest request)
    {
        supervisorDeadline.OnCleanupStarting();
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
        string? lastTerminalWaitState = null;
        var sourceObservation = observeMsiActivity is null && source is { } sourceOwner
            ? new MsiSourceObservationContext(() => sourceOwner.IsMsiSourceResumed && supervisorDeadline.ElapsedMilliseconds < workDeadline,
                sourceOwner.RetainForMsiObservation, () => supervisorDeadline.ElapsedMilliseconds)
            : null;
        using var msiObservation = new WorkspaceMsiActivityObservation(
            request.Scenario, job, evidence, observeMsiActivity, request, sourceObservation: sourceObservation);

        while (supervisorDeadline.ElapsedMilliseconds < workDeadline)
        {
            source?.Poll(() => supervisorDeadline.ElapsedMilliseconds < workDeadline && !child.Wait(0));
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

            if (rootExited) source?.CloseAdmission();
            if (rootExited && source?.RequiredWorkSettled == true) source.CompleteAtRootExit();

            // Required source I/O and creation are part of the existing absence/host-operation fence.
            // Job accounting and the process handle are separate observations during termination.
            if (activeProcessCount == 0 && rootExited && SourceAbsenceVerified)
            {
                msiObservation.Dispose();
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

                if (source?.SourceErrorCode is not null)
                    return SupervisorOutcome.Failed("processStateInvalid", "notRequired", true, childExitCode);

                evidence.Write("workerResultValidated", "started");
                var validation = Task.Run(() => validateWorkerResult?.Invoke(request) ??
                    WorkerTerminalResultReader.Validate(request));
                if (!supervisorDeadline.WaitForTask(validation, workDeadline))
                {
                    _ = validation.ContinueWith(completed => { _ = completed.Exception; },
                        TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
                    evidence.Write("deadlineExceeded", "failed", errorCode: "deadlineExceeded");
                    return SupervisorOutcome.Failed("deadlineExceeded", "notRequired", true,
                        childExitCode) with { HostOperationsCompleted = false };
                }
                WorkerTerminalResultValidation workerResult;
                try { workerResult = validation.GetAwaiter().GetResult(); }
                catch { workerResult = new(false, "workerResultInvalid"); }
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
                msiObservation.Dispose();
                return FailAfterCleanup(
                    job,
                    request,
                    "processExitFailed",
                    childExitCode,
                    child
                );
            }

            if (rootExited && source?.SourceErrorCode is not null && source.RequiredWorkSettled)
            {
                msiObservation.Dispose();
                return FailAfterCleanup(job, request, "processStateInvalid", childExitCode, child);
            }

            var terminalWaitState = rootExited ? "descendantsPending"
                : activeProcessCount == 0 ? "rootExitReceiptPending" : "rootProcessPending";
            if (terminalWaitState != lastTerminalWaitState)
            {
                evidence.Write("terminalWait", "started", terminalWaitState);
                lastTerminalWaitState = terminalWaitState;
            }

            if (supervisorDeadline.ElapsedMilliseconds >= nextHeartbeat)
            {
                evidence.Write("waitHeartbeat", "heartbeat", terminalWaitState);
                nextHeartbeat += HeartbeatMilliseconds;
            }

            msiObservation.Poll(supervisorDeadline.ElapsedMilliseconds);

            var remaining = workDeadline - supervisorDeadline.ElapsedMilliseconds;
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
        msiObservation.Dispose();
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
        source?.CloseAdmission();
        supervisorDeadline.OnCleanupStarting();
        // Test scheduling only: the existing cleanup always resumes after this bounded window.
        try { sourceContext?.Proof.RetirementRace?.AfterRetirement(failureCode, supervisorDeadline.ElapsedMilliseconds); }
        catch (Exception error) { sourceContext?.Proof.RetirementRace?.RecordHookFailure(error); }
        finally { sourceContext?.Proof.RetirementRace?.ReleasePublication(); }
        if (!cleanupStarted) evidence.Write("cleanupStarted", "started");
        try
        {
            if (job.GetActiveProcessCount() == 0 && (child is null || child.Wait(0)) && SourceAbsenceVerified)
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
        while (supervisorDeadline.ElapsedMilliseconds < request.TimeoutMilliseconds)
        {
            var creationWasPending = source?.CreationSettled == false;
            source?.Poll(static () => false);
            if (creationWasPending && source?.CreationSettled == true && !source.SourceSignalled) job.Terminate();
            if (job.GetActiveProcessCount() == 0 && (child is null || child.Wait(0)) && SourceAbsenceVerified)
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

            var remaining = request.TimeoutMilliseconds - supervisorDeadline.ElapsedMilliseconds;
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
        ) with { HostOperationsCompleted = source?.RequiredWorkSettled ?? true };
    }
}
