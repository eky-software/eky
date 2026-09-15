using System.Diagnostics;
using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

internal static class SupervisorProgram
{
    private static readonly int ExitReserveMilliseconds = ReadExitReserve();

    private static int ReadExitReserve()
    {
        using var stream = typeof(SupervisorProgram).Assembly.GetManifestResourceStream("supervisorCommandBudgets.json")!;
        using var json = JsonDocument.Parse(stream);
        return json.RootElement.GetProperty("exitReserveMilliseconds").GetInt32();
    }

    internal static int Run(string[] arguments) => RunPhase(arguments).ExitCode;

    internal static int Run(
        string[] arguments,
        Func<SupervisorRequest, Stopwatch, SafeEvidenceWriter, SupervisorOutcome> execute
    ) => RunPhase(arguments, execute).ExitCode;

    internal static SupervisorPhaseCompletion RunPhase(string[] arguments) => RunPhase(
        arguments,
        static (request, stopwatch, evidence) =>
            new WindowsJobProcessSupervisor(stopwatch, evidence).Run(request)
    );

    internal static SupervisorPhaseCompletion RunPhase(
        string[] arguments,
        Func<SupervisorRequest, Stopwatch, SafeEvidenceWriter, SupervisorOutcome> execute,
        Action<SupervisorRequest, SupervisorOutcome, long>? writeResult = null
    ) => RunPhase(() => SupervisorRequestReader.Read(arguments), execute, writeResult);

    internal static SupervisorPhaseCompletion RunPhase(
        Func<SupervisorRequest> prepareRequest,
        Func<SupervisorRequest, Stopwatch, SafeEvidenceWriter, SupervisorOutcome>? execute = null,
        Action<SupervisorRequest, SupervisorOutcome, long>? writeResult = null,
        SafeEvidenceWriter? commandEvidence = null
    )
    {
        var stopwatch = Stopwatch.StartNew();
        SupervisorRequest? request = null;
        SafeEvidenceWriter? evidence = null;

        try
        {
            var admission = Task.Run(prepareRequest);
            if (Task.WaitAny([admission], ExitReserveMilliseconds) != 0)
            {
                _ = admission.ContinueWith(completed => { _ = completed.Exception; },
                    TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
                throw new SupervisorFailure("requestFileInvalid");
            }
            request = admission.GetAwaiter().GetResult();
            evidence = commandEvidence ?? new SafeEvidenceWriter(request.Scenario, stopwatch);
            evidence.Write("requestValidated", "completed");

            var outcome = execute is null
                ? new WindowsJobProcessSupervisor(stopwatch, evidence).Run(request)
                : execute(request, stopwatch, evidence);
            if (!TryWriteResult(request, outcome, stopwatch, evidence, writeResult))
            {
                evidence.Write("supervisor", "failed", errorCode: "resultWriteFailed");
                return new(outcome, false);
            }
            evidence.Write(
                "supervisor",
                outcome.Status,
                outcome.Status == "completed" ? outcome.ProcessResultCode : null,
                outcome.Status == "failed" ? outcome.ProcessResultCode : null,
                outcome.ProcessWin32ErrorCode
            );
            return new(outcome, true);
        }
        catch (SupervisorFailure failure)
        {
            if (request is not null)
            {
                var outcome = SupervisorOutcome.UnverifiedFailure(failure);
                var resultWritten = TryWriteResult(request, outcome, stopwatch, evidence, writeResult);
                evidence?.Write(
                    "supervisor",
                    "failed",
                    errorCode: failure.ErrorCode,
                    win32ErrorCode: failure.Win32ErrorCode
                );
                return new(outcome, resultWritten);
            }
            else
            {
                SafeEvidenceWriter.WriteInvalidRequest(
                    failure.ErrorCode,
                    failure.Win32ErrorCode
                );
            }
            return new(null, false, failure.ErrorCode);
        }
        catch
        {
            if (request is not null)
            {
                var outcome = SupervisorOutcome.Failed(
                    "unexpectedFailure",
                    "cleanupUnverified",
                    false
                );
                var resultWritten = TryWriteResult(request, outcome, stopwatch, evidence, writeResult);
                evidence?.Write(
                    "supervisor",
                    "failed",
                    errorCode: "unexpectedFailure"
                );
                return new(outcome, resultWritten);
            }
            else
            {
                SafeEvidenceWriter.WriteInvalidRequest("unexpectedFailure");
            }
            return new(null, false, "unexpectedFailure");
        }
        finally
        {
            if (request is not null && commandEvidence is null)
                evidence?.CompleteWithinRequestBudget(request.TimeoutMilliseconds);
        }
    }

    private static bool TryWriteResult(
        SupervisorRequest request,
        SupervisorOutcome outcome,
        Stopwatch stopwatch,
        SafeEvidenceWriter? evidence,
        Action<SupervisorRequest, SupervisorOutcome, long>? writeResult
    )
    {
        try
        {
            // Use the existing caller exit reservation, never extend the
            // process work/cleanup allowance. A late write cannot authorize
            // another phase; the command exits with resultWritten=false.
            var duration = stopwatch.ElapsedMilliseconds;
            var remaining = Math.Min(ExitReserveMilliseconds,
                request.TimeoutMilliseconds + (long)ExitReserveMilliseconds - duration);
            if (remaining <= 0) throw new SupervisorResultWriteFailure();
            var publication = Task.Run(() =>
                (writeResult ?? SupervisorResultWriter.Write)(request, outcome, duration));
            if (Task.WaitAny([publication], (int)remaining) != 0)
            {
                _ = publication.ContinueWith(completed => { _ = completed.Exception; },
                    TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
                throw new SupervisorResultWriteFailure();
            }
            publication.GetAwaiter().GetResult();
            evidence?.Write("resultWritten", "completed");
            return true;
        }
        catch
        {
            evidence?.Write(
                "resultWritten",
                "failed",
                errorCode: "resultWriteFailed"
            );
            return false;
        }
    }
}

internal sealed record SupervisorPhaseCompletion(
    SupervisorOutcome? Outcome,
    bool ResultWritten,
    string? RequestErrorCode = null
)
{
    internal int ExitCode => ResultWritten && Outcome?.Status == "completed" ? 0 : 1;

    // This is only the process boundary. It never authorizes MSI mutation or
    // fixture removal; the scenario's existing postconditions still own those.
    internal bool ProcessBoundaryVerified => ResultWritten && Outcome is
    {
        ProcessTreeAbsent: true,
        CleanupResultCode: "notRequired" or "processTreeAbsent",
        HostOperationsCompleted: true,
    };
}
