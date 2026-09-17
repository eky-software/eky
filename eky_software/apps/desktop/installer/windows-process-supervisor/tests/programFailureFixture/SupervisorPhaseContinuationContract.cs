using System.Text.Json;
using Eky.WindowsProcessSupervisor;

internal static class SupervisorPhaseContinuationContract
{
    internal static int Run(string mode, string requestPath)
    {
        if (mode is "phaseContinuationRequestFileCompleted" or "phaseContinuationRequestFileExists" or
            "phaseContinuationRequestFileHold" or "phaseContinuationRequestFileLate")
            return RunRequestFilePreparation(mode, requestPath);
        if (mode is "phaseContinuationRequestPreparationHold" or
            "phaseContinuationRequestPreparationThrow" or "phaseContinuationRequestPreparationInvalid" or
            "phaseContinuationLateRequestPreparation" or "phaseContinuationLateRequestPreparationFailure")
            return RunRequestPreparation(mode, requestPath);
        if (mode is not ("phaseContinuationCompleted" or "phaseContinuationWorkerFailed" or
            "phaseContinuationDeadline" or "phaseContinuationCleanupUnverified" or
            "phaseContinuationPublicationFailed" or "phaseContinuationRequestInvalid" or
            "phaseContinuationBlockedEvidence" or "phaseContinuationWorkerReadHold" or
            "phaseContinuationResultWriteHold" or "phaseContinuationResultWriteHoldAfterFailure" or
            "phaseContinuationPublicationBudgetExhausted" or "phaseContinuationLateResultWrite")) return 64;

        var root = Path.GetDirectoryName(requestPath)!;
        var events = new List<string>();
        var publicationPhases = new List<string>();
        using var releaseWrite = new ManualResetEvent(false);
        using var writeFinished = new ManualResetEvent(false);
        void ObservedWrite(SupervisorRequest request, SupervisorOutcome outcome, long duration)
        {
            try
            {
                SupervisorResultWriter.Write(request, outcome, duration, (phase, completed) =>
                {
                    publicationPhases.Add(JsonNamingPolicy.CamelCase.ConvertName(phase.ToString()) +
                        (completed ? ":completed" : ":started"));
                    if (mode == "phaseContinuationLateResultWrite" &&
                        phase == SupervisorResultWritePhase.Flush && !completed)
                    {
                        File.WriteAllText(Path.Combine(root, "host-io-entered.json"),
                            "{\"schemaVersion\":1,\"phase\":\"flush\"}");
                        releaseWrite.WaitOne();
                    }
                    throw new InvalidOperationException("privateFixtureObserverFailure");
                });
            }
            finally { writeFinished.Set(); }
        }
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
            if (mode == "phaseContinuationPublicationBudgetExhausted")
            {
                using var budgetStream = typeof(SupervisorProgram).Assembly
                    .GetManifestResourceStream("supervisorCommandBudgets.json")!;
                using var budgets = JsonDocument.Parse(budgetStream);
                var deadline = request.TimeoutMilliseconds +
                    (long)budgets.RootElement.GetProperty("exitReserveMilliseconds").GetInt32();
                // Deliberately consume the real publication reserve after owned work exits.
                using var held = new ManualResetEvent(false);
                while (clock.ElapsedMilliseconds <= deadline)
                    held.WaitOne(TimeSpan.FromMilliseconds(Math.Max(1, deadline - clock.ElapsedMilliseconds + 1)));
                File.WriteAllText(Path.Combine(root, "host-io-entered.json"),
                    "{\"schemaVersion\":1,\"phase\":\"publicationBudgetExhausted\"}");
            }
            if (mode == "phaseContinuationPublicationFailed") Directory.CreateDirectory(request.ResultPath);
            // Model loss of cleanup proof without leaving a real uncontrolled process.
            return mode == "phaseContinuationCleanupUnverified"
                ? outcome with { Status = "failed", CleanupResultCode = "cleanupUnverified", ProcessTreeAbsent = false }
                : outcome;
        }, mode is "phaseContinuationResultWriteHold" or "phaseContinuationResultWriteHoldAfterFailure" or
            "phaseContinuationPublicationBudgetExhausted"
            ? HeldResultWrite : mode is "phaseContinuationCompleted" or "phaseContinuationLateResultWrite"
                ? ObservedWrite : null);
        events.Add("firstPhaseReturned");
        bool? rootPresentBeforeRelease = null;
        bool? resultAbsentBeforeRelease = null;
        bool? lateWriteCompleted = null;
        if (mode == "phaseContinuationLateResultWrite")
        {
            rootPresentBeforeRelease = Directory.Exists(root);
            resultAbsentBeforeRelease = !File.Exists(Path.Combine(root, "result.json"));
            releaseWrite.Set();
            // Only the fixture waits here, after the real phase has rejected publication.
            // The command under test never extends its publication budget.
            lateWriteCompleted = writeFinished.WaitOne(TimeSpan.FromSeconds(5));
            if (lateWriteCompleted != true) return 1;
            events.Add("lateWriterReturned");
        }
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
            publicationPhases,
            rootPresentBeforeRelease,
            resultAbsentBeforeRelease,
            lateWriteCompleted,
            exitCode,
        }));
        return exitCode;
    }

    private static WorkerTerminalResultValidation HeldWorkerResult(SupervisorRequest request)
    {
        Hold(request, "workerRead");
        return new(false, "workerResultInvalid");
    }

    private static int RunRequestFilePreparation(string mode, string requestPath)
    {
        var root = Path.GetDirectoryName(requestPath)!;
        var preparedPath = Path.Combine(root, "prepared-request.json");
        using var input = JsonDocument.Parse(File.ReadAllText(requestPath));
        using var release = new ManualResetEvent(false);
        using var finished = new ManualResetEvent(false);
        var observations = new List<string>();
        var workerStarted = false;
        if (mode == "phaseContinuationRequestFileExists")
            File.WriteAllText(preparedPath, "{\"sentinel\":true}");
        var first = SupervisorProgram.RunPhase(observe =>
        {
            try
            {
                AcceptanceCommandProgram.WriteExclusive(preparedPath, input.RootElement, (phase, completed) =>
                {
                    observe(phase, completed);
                    observations.Add(JsonNamingPolicy.CamelCase.ConvertName(phase.ToString()) +
                        (completed ? ":completed" : ":started"));
                    if (phase == SupervisorRequestPreparationPhase.RequestFlush && !completed &&
                        mode is "phaseContinuationRequestFileHold" or "phaseContinuationRequestFileLate")
                    {
                        File.WriteAllText(Path.Combine(root, "host-io-entered.json"),
                            "{\"schemaVersion\":1,\"phase\":\"requestFlush\"}");
                        release.WaitOne();
                    }
                    throw new InvalidOperationException("privateObservationFailure");
                });
                return SupervisorRequestReader.Read(["--request", preparedPath], observe);
            }
            finally { finished.Set(); }
        }, (request, clock, evidence) =>
        {
            workerStarted = true;
            return new WindowsJobProcessSupervisor(clock, evidence).Run(request);
        });
        bool? latePreparationCompleted = null;
        if (mode == "phaseContinuationRequestFileLate")
        {
            release.Set();
            latePreparationCompleted = finished.WaitOne(TimeSpan.FromSeconds(5));
            if (latePreparationCompleted != true) return 65;
        }
        File.WriteAllText(Path.Combine(root, "phase-completion.json"), JsonSerializer.Serialize(new
        {
            schemaVersion = 1, first = Report(first), observations, workerStarted,
            latePreparationCompleted, rootPresent = Directory.Exists(root),
        }));
        return first.ExitCode;
    }

    private static int RunRequestPreparation(string mode, string requestPath)
    {
        var root = Path.GetDirectoryName(requestPath)!;
        using var release = new ManualResetEvent(false);
        using var finished = new ManualResetEvent(false);
        var workerStarted = false;
        var resultWriterStarted = false;
        string? preparationOutcome = null;
        var first = SupervisorProgram.RunPhase(observe =>
        {
            File.WriteAllText(Path.Combine(root, "host-io-entered.json"),
                "{\"schemaVersion\":1,\"phase\":\"requestPreparation\"}");
            if (mode == "phaseContinuationRequestPreparationThrow")
                throw new IOException("privatePreparationFailure");
            if (mode == "phaseContinuationRequestPreparationInvalid")
                throw new SupervisorFailure("requestFileInvalid");
            release.WaitOne();
            try
            {
                if (mode == "phaseContinuationLateRequestPreparationFailure")
                    throw new IOException("privateLatePreparationFailure");
                var prepared = SupervisorRequestReader.Read(["--request", requestPath], (phase, completed) =>
                {
                    observe(phase, completed);
                    throw new InvalidOperationException("privateObservationFailure");
                });
                preparationOutcome = "requestReturned";
                return prepared;
            }
            catch { preparationOutcome = "preparationFailed"; throw; }
            finally { finished.Set(); }
        }, (request, clock, evidence) =>
        {
            workerStarted = true;
            return new WindowsJobProcessSupervisor(clock, evidence).Run(request);
        }, (_, _, _) => { resultWriterStarted = true; });
        var events = new List<string> { "firstPhaseReturned" };
        bool? latePreparationCompleted = null;
        if (mode is "phaseContinuationLateRequestPreparation" or "phaseContinuationLateRequestPreparationFailure")
        {
            release.Set();
            latePreparationCompleted = finished.WaitOne(TimeSpan.FromSeconds(5));
            if (latePreparationCompleted != true) return 65;
            events.Add("latePreparationReturned");
        }
        File.WriteAllText(Path.Combine(root, "phase-completion.json"), JsonSerializer.Serialize(new
        {
            schemaVersion = 1, first = Report(first), events, workerStarted, resultWriterStarted,
            latePreparationCompleted, preparationOutcome, rootPresent = Directory.Exists(root),
        }));
        return first.ExitCode;
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
