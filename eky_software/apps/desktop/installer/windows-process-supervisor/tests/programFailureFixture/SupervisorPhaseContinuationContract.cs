using System.Text.Json;
using Eky.WindowsProcessSupervisor;

internal static class SupervisorPhaseContinuationContract
{
    internal static int Run(string mode, string requestPath)
    {
        if (mode is not ("phaseContinuationCompleted" or "phaseContinuationWorkerFailed" or
            "phaseContinuationDeadline" or "phaseContinuationCleanupUnverified" or
            "phaseContinuationPublicationFailed" or "phaseContinuationRequestInvalid" or
            "phaseContinuationBlockedEvidence" or "phaseContinuationWorkerReadHold" or
            "phaseContinuationResultWriteHold" or "phaseContinuationResultWriteHoldAfterFailure")) return 64;

        var root = Path.GetDirectoryName(requestPath)!;
        var events = new List<string>();
        if (mode == "phaseContinuationBlockedEvidence")
        {
            var request = SupervisorRequestReader.Read(["--request", requestPath]);
            Console.SetOut(new BlockedEvidenceWriter(Console.Out, request));
        }
        var first = SupervisorProgram.RunPhase(["--request", requestPath], (request, clock, evidence) =>
        {
            var outcome = new WindowsJobProcessSupervisor(clock, evidence,
                validateWorkerResult: mode == "phaseContinuationWorkerReadHold"
                    ? HeldWorkerResult : null).Run(request);
            if (mode == "phaseContinuationPublicationFailed") Directory.CreateDirectory(request.ResultPath);
            // Model loss of cleanup proof without leaving a real uncontrolled process.
            return mode == "phaseContinuationCleanupUnverified"
                ? outcome with { Status = "failed", CleanupResultCode = "cleanupUnverified", ProcessTreeAbsent = false }
                : outcome;
        }, mode is "phaseContinuationResultWriteHold" or "phaseContinuationResultWriteHoldAfterFailure"
            ? HeldResultWrite : null);
        events.Add("firstPhaseReturned");
        SupervisorPhaseCompletion? second = null;
        if (first.ProcessBoundaryVerified)
        {
            // The second worker is read-only fixture work, never MSI recovery.
            // This probe tests the technical gate, not semantic cleanup permission.
            events.Add("secondPhaseStarted");
            second = SupervisorProgram.RunPhase(["--request", Path.Combine(root, "next", "request.json")]);
            events.Add("secondPhaseReturned");
        }
        var exitCode = first.ExitCode != 0 ? first.ExitCode : second?.ExitCode ?? 1;
        File.WriteAllText(Path.Combine(root, "phase-completion.json"), JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            first = Report(first),
            second = second is null ? null : Report(second),
            events,
            exitCode,
        }));
        return exitCode;
    }

    private static WorkerTerminalResultValidation HeldWorkerResult(SupervisorRequest request)
    {
        Hold(request, "workerRead");
        return new(false, "workerResultInvalid");
    }

    private static void HeldResultWrite(SupervisorRequest request, SupervisorOutcome _, long __) =>
        Hold(request, "resultWrite");

    private static void Hold(SupervisorRequest request, string phase)
    {
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(request.RequestPath)!, "host-io-entered.json"),
            JsonSerializer.Serialize(new { schemaVersion = 1, phase }));
        using var blocked = new ManualResetEvent(false);
        blocked.WaitOne();
    }

    private static object Report(SupervisorPhaseCompletion completion) => new
    {
        exitCode = completion.ExitCode,
        resultWritten = completion.ResultWritten,
        requestErrorCode = completion.RequestErrorCode,
        processBoundaryVerified = completion.ProcessBoundaryVerified,
        processResultCode = completion.Outcome?.ProcessResultCode,
        workerResultCode = completion.Outcome?.WorkerResultCode,
        cleanupResultCode = completion.Outcome?.CleanupResultCode,
        processTreeAbsent = completion.Outcome?.ProcessTreeAbsent,
    };
}
