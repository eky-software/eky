using System.Diagnostics;

namespace Eky.WindowsProcessSupervisor;

internal static class SupervisorProgram
{
    internal static int Run(string[] arguments) => Run(
        arguments,
        static (request, stopwatch, evidence) =>
            new WindowsJobProcessSupervisor(stopwatch, evidence).Run(request)
    );

    internal static int Run(
        string[] arguments,
        Func<SupervisorRequest, Stopwatch, SafeEvidenceWriter, SupervisorOutcome> execute
    )
    {
        var stopwatch = Stopwatch.StartNew();
        SupervisorRequest? request = null;
        SafeEvidenceWriter? evidence = null;

        try
        {
            request = SupervisorRequestReader.Read(arguments);
            evidence = new SafeEvidenceWriter(request.Scenario, stopwatch);
            evidence.Write("requestValidated", "completed");

            var outcome = execute(request, stopwatch, evidence);
            if (!TryWriteResult(request, outcome, stopwatch, evidence))
            {
                evidence.Write("supervisor", "failed", errorCode: "resultWriteFailed");
                return 1;
            }
            evidence.Write(
                "supervisor",
                outcome.Status,
                outcome.Status == "completed" ? outcome.ProcessResultCode : null,
                outcome.Status == "failed" ? outcome.ProcessResultCode : null,
                outcome.ProcessWin32ErrorCode
            );
            return outcome.Status == "completed" ? 0 : 1;
        }
        catch (SupervisorFailure failure)
        {
            if (request is not null)
            {
                var outcome = SupervisorOutcome.UnverifiedFailure(failure);
                TryWriteResult(request, outcome, stopwatch, evidence);
                evidence?.Write(
                    "supervisor",
                    "failed",
                    errorCode: failure.ErrorCode,
                    win32ErrorCode: failure.Win32ErrorCode
                );
            }
            else
            {
                SafeEvidenceWriter.WriteInvalidRequest(
                    failure.ErrorCode,
                    failure.Win32ErrorCode
                );
            }
            return 1;
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
                TryWriteResult(request, outcome, stopwatch, evidence);
                evidence?.Write(
                    "supervisor",
                    "failed",
                    errorCode: "unexpectedFailure"
                );
            }
            else
            {
                SafeEvidenceWriter.WriteInvalidRequest("unexpectedFailure");
            }
            return 1;
        }
        finally
        {
            if (request is not null)
                evidence?.CompleteWithinRequestBudget(request.TimeoutMilliseconds);
        }
    }

    private static bool TryWriteResult(
        SupervisorRequest request,
        SupervisorOutcome outcome,
        Stopwatch stopwatch,
        SafeEvidenceWriter? evidence
    )
    {
        try
        {
            SupervisorResultWriter.Write(
                request,
                outcome,
                stopwatch.ElapsedMilliseconds
            );
            evidence?.Write("resultWritten", "completed");
            return true;
        }
        catch (SupervisorResultWriteFailure)
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
