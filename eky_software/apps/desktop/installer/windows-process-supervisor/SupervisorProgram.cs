using System.Diagnostics;

namespace Eky.WindowsProcessSupervisor;

internal static class SupervisorProgram
{
    internal static int Run(string[] arguments)
    {
        var stopwatch = Stopwatch.StartNew();
        SupervisorRequest? request = null;
        SafeEvidenceWriter? evidence = null;

        try
        {
            request = SupervisorRequestReader.Read(arguments);
            evidence = new SafeEvidenceWriter(request.Scenario, stopwatch);
            evidence.Write("requestValidated", "completed");

            var outcome = new WindowsJobProcessSupervisor(stopwatch, evidence)
                .Run(request);
            SupervisorResultWriter.Write(request, outcome, stopwatch.ElapsedMilliseconds);
            evidence.Write("resultWritten", "completed");
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
                try
                {
                    SupervisorResultWriter.Write(
                        request,
                        outcome,
                        stopwatch.ElapsedMilliseconds
                    );
                    evidence?.Write("resultWritten", "completed");
                }
                catch
                {
                    evidence?.Write(
                        "resultWritten",
                        "failed",
                        errorCode: "resultWriteFailed"
                    );
                }
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
    }
}
