using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

namespace Eky.AdmittedSourceTransport;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--joint-resource-binding")
        {
            var resources = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var name in new[] { "source-bootstrap-projection.private.json", "bridge-protocol.private.json" })
            {
                using var stream = typeof(SourceBootstrapProjection).Assembly.GetManifestResourceStream(name)
                    ?? throw new InvalidDataException("JOINT_RESOURCE_MISSING");
                resources.Add(name, Convert.ToHexStringLower(SHA256.HashData(stream)));
            }
            Console.WriteLine(JsonSerializer.Serialize(resources));
            return 0;
        }
        if (args.Length == 1 && args[0] == "--joint-reservation-close-controls")
            return JointReservationCloseControls.Run();
        if (args.Length != 4 || args[0] != "--joint-reservation-proof") return 64;
        var selected = args[1];
        if (selected is not ("exit0" or "sourceHold") ||
            !SourceBridgeProtocol.Read().Cases.Contains(selected, StringComparer.Ordinal)) return 64;
        var root = args[2];
        var directory = args[3];
        var originalTemporaryRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
        try { ValidateFixturePaths(root, directory, originalTemporaryRoot); }
        catch { return 64; }
        var checks = new Dictionary<string, bool>(StringComparer.Ordinal);
        string? firstFailure = null;
        object? harnessFailure = null;
        void Check(string name, bool value) { checks[name] = value; if (!value) firstFailure ??= name; }
        var clock = Stopwatch.StartNew();
        var proof = new SourceAdmissionExperiment(selected) { FixtureDirectory = directory };
        string? commandRoot = null;
        string? runRoot = null;
        JsonElement? sourceProof = null;
        JsonElement? reservationProof = null;
        JsonElement? nativeResult = null;
        int? exit = null;
        void Snapshot(Action capture)
        {
            try { capture(); }
            catch (Exception error)
            {
                firstFailure ??= "reservedTransportSnapshotException";
                harnessFailure ??= new { exceptionType = error.GetType().Name, error.HResult,
                    errorCode = (error as SupervisorFailure)?.ErrorCode };
            }
        }
        try
        {
            Environment.SetEnvironmentVariable("TEMP", root);
            Environment.SetEnvironmentVariable("TMP", root);
            Environment.SetEnvironmentVariable("APPDATA", Path.Combine(root, "roaming"));
            Environment.SetEnvironmentVariable("LOCALAPPDATA", Path.Combine(root, "local"));
            Environment.SetEnvironmentVariable("EKY_M51_ADMITTED_TRANSPORT_CASE", selected);
            Environment.SetEnvironmentVariable("EKY_FAKE", "synthetic-excluded");
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "1");
            Environment.SetEnvironmentVariable("UNCHANGED", "synthetic-kept");
            Environment.SetEnvironmentVariable("UNICODE_VALUE", "\u00e4\u4e2d");
            Environment.SetEnvironmentVariable("EMPTY_VALUE", "");
            using var input = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root, "control.private.json")));
            var config = input.RootElement;
            Environment.SetEnvironmentVariable("npm_node_execpath", config.GetProperty("node").GetString());
            var descriptor = Path.Combine(root, config.GetProperty("descriptorFilename").GetString()!);
            var caller = Path.Combine(root, config.GetProperty("callerResultPrefix").GetString()! + Guid.NewGuid().ToString("N"),
                config.GetProperty("callerResultFilename").GetString()!);
            var fault = selected == "fault0";
            var command = new List<string> { fault ? "--workspace-fault-command" : "--workspace-success-command",
                "--artifact-descriptor", descriptor, "--expected-descriptor-sha256", new('a', 64),
                "--expected-build-revision", new('b', 40) };
            if (fault) { command.Add("--fault-scenario"); command.Add(SourceBootstrapProjection.Read().FaultScenarios[0]); }
            command.Add("--result-path"); command.Add(caller);
            proof.BeforeAdmission = anchors =>
            {
                commandRoot = anchors.CommandRoot;
                Check("realOrderedPrefix", anchors.ExpectedPrefix.SequenceEqual(new[] {
                    "prepare", "inventoryBefore", "materialize", "inspectSourceBefore", "inspectTargetBefore", "scenarioPreparation" }));
            };
            proof.BeforeCreation = admission =>
            {
                runRoot = admission.RunRoot;
                Check("distinctMailboxAndSourceDirectory", admission.MailboxRoot != admission.WorkingDirectory);
            };
            exit = AcceptanceCommandProgram.Run(command.ToArray(), Path.Combine(directory, "sourceHandoffPhase.mjs"),
                phase => selected is "heldRead" or "sourceHold" or "heldCreation" && phase == "scenario" ? (4_000, 1_000) : (35_000, 5_000),
                contractAdmission: proof);
            if (selected == "heldRead")
            {
                Check("pendingReadRetainsAdmission", proof.TransportReadHeld.IsSet && !proof.DeferredRelease.IsCompleted &&
                    proof.Current is { AllHandlesClosed: false });
                proof.TransportReadRelease.Set();
            }
            if (selected == "heldCreation")
            {
                Check("sourceCreationRetainsAdmission", proof.SourceCreationHeld.IsSet && !proof.DeferredRelease.IsCompleted &&
                    proof.Current is { AllHandlesClosed: false });
                proof.SourceCreationRelease.Set();
            }
            // No post-phase grace period: pending work remains a failed/uncertain fixture.
            Check("allRequiredWorkSettled", proof.DeferredRelease.IsCompletedSuccessfully);
            Check("realAdmissionConsumedOnce", proof.MetadataValidated && proof.Published && proof.Consumed == 1 && proof.WorkerStarts == 1);
            Check("allFourteenPinsClosed", proof.Current is { PinCount: 14, AllHandlesClosed: true });
            Check("admissionReaderSettled", proof.ReaderFinished.IsSet && proof.PreparationFinished.IsSet);
            var releaseFailure = selected is "exit7CleanupFailure" or "exit0CleanupFailure";
            Check("admissionCleanupMatchesCase", releaseFailure ? proof.CleanupFailure is not null : proof.CleanupFailure is null);
            Check("commandNotAccepted", exit == 1);
            var positive = selected is "exit0" or "fault0";
            Check("boundedCheckpointMatchesCase", proof.BoundedStopAfterScenario == positive);
            sourceProof = JsonSerializer.SerializeToElement(proof.SourceProof ?? throw new InvalidDataException());
            var source = sourceProof.Value;
            Check("sourceRequiredWorkSettled", source.GetProperty("requiredWorkSettled").GetBoolean());
            Check("sourceHandlesClosed", source.GetProperty("sourceHandlesClosed").GetBoolean());
            Check("allSourceResourcesClosed", source.GetProperty("allSettledResourcesClosed").GetBoolean());
            reservationProof = JsonSerializer.SerializeToElement(proof.ReservationProof ?? throw new InvalidDataException());
            var reservation = reservationProof.Value;
            Check("realReservationEnteredBeforeOwner", reservation.GetProperty("entered").GetBoolean() &&
                reservation.GetProperty("entryReady").GetBoolean() && reservation.GetProperty("ownerStarted").GetBoolean() &&
                reservation.GetProperty("enteredAtMs").GetInt64() <= reservation.GetProperty("ownerStartedAtMs").GetInt64());
            Check("reservationTaskAndPinSettled", reservation.GetProperty("taskSettled").GetBoolean() &&
                reservation.GetProperty("pinClosed").GetBoolean() && reservation.GetProperty("resourcesReleased").GetBoolean() &&
                reservation.GetProperty("allControlHandlesClosed").GetBoolean() &&
                reservation.GetProperty("reservationResourcesSettled").GetBoolean());
            Check("reservationCleanupSeparate", reservation.GetProperty("cleanupFailures").GetArrayLength() == 0);
            Check("optionalObserverStillNone", reservation.GetProperty("optionalMsiObserver").GetString() == "none");
            Check("lateFrameGapNotClaimed", !reservation.GetProperty("lateFrameAuthorityProved").GetBoolean());
            Check("sourceReleaseMatchesCase", source.GetProperty("releaseFailed").GetBoolean() == releaseFailure);
            var noSource = selected is "wrongBinding" or "heldRead";
            Check("exactSourceCreationCount", source.GetProperty("creationAttempts").GetInt32() == (noSource ? 0 : 1));
            if (!noSource && selected is not ("heldCreation" or "birthRejected"))
            {
                Check("birthAndSameJobBeforeResume", source.GetProperty("birthCapturedBeforeResume").GetBoolean() &&
                    source.GetProperty("sourceInSameJobBeforeResume").GetBoolean());
                var birth = source.GetProperty("sourceBirth");
                Check("actualBirthIdentityRetained", birth.GetProperty("ProcessId").GetUInt32() != 0 &&
                    (birth.GetProperty("StartTimeLow").GetUInt32() != 0 || birth.GetProperty("StartTimeHigh").GetUInt32() != 0));
                Check("samePhaseClockOrdered", source.GetProperty("birthObservedAtMs").GetInt64() <= source.GetProperty("resumeStartedAtMs").GetInt64() &&
                    source.GetProperty("resumeStartedAtMs").GetInt64() <= source.GetProperty("resumeReturnedAtMs").GetInt64());
                Check("reservationEntryPrecedesActualSourceBirth", reservation.GetProperty("ownerStartedAtMs").GetInt64() <=
                    source.GetProperty("birthObservedAtMs").GetInt64());
            }
            if (selected == "heldCreation") Check("cancelledCreationNeverResumed", source.GetProperty("sourceBirth").ValueKind == JsonValueKind.Null &&
                source.GetProperty("resumeStartedAtMs").ValueKind == JsonValueKind.Null);
            if (selected == "birthRejected") Check("missingBirthNeverResumed", !source.GetProperty("birthCapturedBeforeResume").GetBoolean() &&
                source.GetProperty("sourceBirth").ValueKind == JsonValueKind.Null && source.GetProperty("resumeStartedAtMs").ValueKind == JsonValueKind.Null &&
                source.GetProperty("sourceErrorCode").GetString() == "ownedProcessStartFailed");
            if (selected is "sourceHold" or "heldRead" or "heldCreation" or "birthRejected")
                Check("cleanupNeverClaimsNaturalExit", !source.GetProperty("sourceExited").GetBoolean());
            else if (selected != "wrongBinding")
                Check("naturalExitCodeDelivered", source.GetProperty("sourceExited").GetBoolean() &&
                    source.GetProperty("sourceExitCode").GetInt32() == (selected is "exit7" or "exit7CleanupFailure" ? 7 : 0));
            if (selected == "wrongBinding") Check("badBindingRejectedBeforeCreate", source.GetProperty("requestRejected").GetBoolean());
            if (selected == "replay") Check("replayRejected", source.GetProperty("replayRejected").GetBoolean());
            using var result = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(commandRoot!, "scenario", "result.json")));
            nativeResult = result.RootElement.Clone();
            var native = nativeResult.Value;
            Check("originalNativeStatus", native.GetProperty("status").GetString() == (positive ? "completed" : "failed"));
            Check("nativeTreeAbsenceProved", native.GetProperty("processTreeAbsent").GetBoolean());
            Check("actualFinalOwnerHostWorkCompleted", proof.FinalOwnerOutcome?.HostOperationsCompleted == true);
            Check("actualFinalOwnerMatchesNative", proof.FinalOwnerOutcome is { } final &&
                final.Status == native.GetProperty("status").GetString() &&
                final.ProcessResultCode == native.GetProperty("processResultCode").GetString() &&
                final.CleanupResultCode == native.GetProperty("cleanupResultCode").GetString() &&
                final.ProcessTreeAbsent == native.GetProperty("processTreeAbsent").GetBoolean());
            if (positive)
            {
                Check("recordedExchangeBeforeReturn", reservation.GetProperty("publication").GetString() == "recorded" &&
                    reservation.GetProperty("exchangeCompleted").GetBoolean() && reservation.GetProperty("returned").GetBoolean() &&
                    reservation.GetProperty("exchangeSucceeded").GetBoolean() &&
                    reservation.GetProperty("firstFailure").ValueKind == JsonValueKind.Null);
                var binding = reservation.GetProperty("actualEvidenceBinding");
                Check("actualRecordedEvidenceBound", binding.GetProperty("runNonce").GetString() == native.GetProperty("runNonce").GetString() &&
                    binding.GetProperty("scenario").GetString() == native.GetProperty("scenario").GetString() &&
                    binding.GetProperty("artifactDescriptorSha256").GetString() == native.GetProperty("artifactDescriptorSha256").GetString() &&
                    binding.GetProperty("schemaVersion").GetInt32() == MsiWindowObservation.Contract.SchemaVersion &&
                    binding.GetProperty("binding").ValueKind == JsonValueKind.Object &&
                    reservation.GetProperty("actualEvidenceBytes").GetInt32() >= 2 &&
                    reservation.GetProperty("actualEvidenceBytes").GetInt32() <= MsiWindowObservation.Contract.MaximumBytes &&
                    reservation.GetProperty("actualEvidenceSha256").GetString() is { Length: 64 });
                Check("realWorkerResultValidated", native.GetProperty("workerResultCode").GetString() == "workerResultValidated" &&
                    source.GetProperty("resultDeliveredBeforeRetirement").GetBoolean());
                Check("workerEnteredAfterExchange", reservation.GetProperty("workerContinuationObserved").GetBoolean());
            }
            else
            {
                Check("abortNeverCompletesExchange", !reservation.GetProperty("exchangeCompleted").GetBoolean() &&
                    !reservation.GetProperty("returned").GetBoolean() && reservation.GetProperty("publication").GetString() != "recorded" &&
                    !reservation.GetProperty("exchangeSucceeded").GetBoolean() &&
                    reservation.GetProperty("actualEvidenceBinding").ValueKind == JsonValueKind.Null);
                Check("abortReasonRetained", reservation.GetProperty("firstFailure").GetProperty("type").GetString()
                    is "TimeoutException" or "OperationCanceledException");
                Check("abortNeverEntersBusinessWorker", !reservation.GetProperty("workerContinuationObserved").GetBoolean() &&
                    native.GetProperty("workerResultCode").GetString() == "notChecked" &&
                    !source.GetProperty("resultDeliveredBeforeRetirement").GetBoolean());
                var original = source.GetProperty("originalOwnerOutcome");
                Check("reservationAbortBoundaryPreserved", native.GetProperty("status").GetString() == "failed" &&
                    native.GetProperty("processResultCode").GetString() == "deadlineExceeded" &&
                    native.GetProperty("processTreeAbsent").GetBoolean() && (proof.FinalOwnerOutcome?.HostOperationsCompleted == true) &&
                    native.GetProperty("processTreeAbsent").GetBoolean() == original.GetProperty("ProcessTreeAbsent").GetBoolean() &&
                    (proof.FinalOwnerOutcome?.HostOperationsCompleted == true) == source.GetProperty("originalOwnerHostOperationsCompleted").GetBoolean() &&
                    native.GetProperty("cleanupResultCode").GetString() == original.GetProperty("CleanupResultCode").GetString());
                Check("underlyingJobCleanupRetainedSeparately", source.GetProperty("originalOwnerOutcome").GetProperty("ProcessTreeAbsent").GetBoolean());
                Check("reservationHeldAtNativeClose", reservation.GetProperty("nativeCloseObserved").GetBoolean() &&
                    reservation.GetProperty("reservationHeldAtNativeClose").GetBoolean());
                Check("callbackReleasedAfterNativeClose", reservation.GetProperty("releaseAfterNativeClose").GetBoolean() &&
                    reservation.GetProperty("callbackReleasedAtMs").GetInt64() >= reservation.GetProperty("nativeCloseAtMs").GetInt64() &&
                    !reservation.GetProperty("unwindRelease").GetBoolean());
                Check("callbackReturnedWithinNativeBudget", reservation.GetProperty("nativeCloseAtMs").GetInt64() >= 3_000 &&
                    reservation.GetProperty("callbackReturnedAtMs").GetInt64() >= reservation.GetProperty("callbackReleasedAtMs").GetInt64() &&
                    reservation.GetProperty("callbackReturnedAtMs").GetInt64() < 4_000);
            }
            if (selected is "sourceHold" or "heldRead" or "heldCreation") Check("originalDeadlinePreserved", native.GetProperty("processResultCode").GetString() == "deadlineExceeded");
            if (selected == "exit7CleanupFailure") Check("firstFailureSurvivesReleaseFailure",
                native.GetProperty("processResultCode").GetString() == "processExitFailed" && native.GetProperty("childExitCode").GetInt32() == 7 &&
                native.GetProperty("cleanupResultCode").GetString() == "cleanupFailed" && source.GetProperty("releaseAttempts").GetInt32() == 4);
            if (selected == "exit0CleanupFailure") Check("validatedWorkerOutcomeRetainedSeparately",
                native.GetProperty("processResultCode").GetString() == "processStateInvalid" && native.GetProperty("workerResultCode").GetString() == "notChecked" &&
                native.GetProperty("childExitCode").GetInt32() == 0 && native.GetProperty("cleanupResultCode").GetString() == "cleanupFailed" &&
                source.GetProperty("originalOwnerOutcome").GetProperty("Status").GetString() == "completed" &&
                source.GetProperty("originalOwnerOutcome").GetProperty("WorkerResultCode").GetString() == "workerResultValidated");
        }
        catch (Exception error)
        {
            firstFailure ??= "reservedTransportFixtureException";
            harnessFailure = new { exceptionType = error.GetType().Name, error.HResult,
                errorCode = (error as SupervisorFailure)?.ErrorCode };
        }
        finally
        {
            proof.TransportReadRelease.Set(); proof.SourceCreationRelease.Set();
            // Capture each available report independently, including after an assertion fails.
            Snapshot(() =>
            {
                if (proof.SourceProof is { } available) sourceProof = JsonSerializer.SerializeToElement(available);
            });
            Snapshot(() =>
            {
                if (proof.ReservationProof is { } available) reservationProof = JsonSerializer.SerializeToElement(available);
            });
            Snapshot(() =>
            {
                if (commandRoot is null) return;
                var path = Path.Combine(commandRoot, "scenario", "result.json");
                if (!File.Exists(path)) return;
                using var result = JsonDocument.Parse(File.ReadAllBytes(path));
                nativeResult = result.RootElement.Clone();
            });
        }
        var status = firstFailure is null ? "completed" : "failed";
        using var output = new FileStream(Path.Combine(root, "joint-reservation-result.private.json"),
            FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(output, new { schemaVersion = 1, selected, status, checks, firstFailure, harnessFailure,
            commandExit = exit, durationMs = clock.ElapsedMilliseconds, commandRoot, runRoot, sourceProof, reservationProof, nativeResult,
            finalOwnerOutcome = proof.FinalOwnerOutcome is { } finalOwner ? new
            {
                finalOwner.Status, finalOwner.ProcessResultCode, finalOwner.WorkerResultCode, finalOwner.CleanupResultCode,
                finalOwner.ProcessTreeAbsent, finalOwner.HostOperationsCompleted, finalOwner.ChildExitCode,
                finalOwner.ProcessWin32ErrorCode, finalOwner.CleanupWin32ErrorCode,
            } : null,
            admissionFirstFailure = proof.FirstFailure, admissionCleanupFailure = proof.CleanupFailure,
            boundedStopAfterScenario = proof.BoundedStopAfterScenario, postScenarioPhases = "notRun",
            scope = "twoCaseRealReservationSyntheticTransport", lateFrameWorkerRetirementGap = "open",
            fullCommandAccepted = false, sourceEkyExecuted = false, originalMsiCauseEstablished = false });
        output.Flush(true);
        var elapsedMs = clock.ElapsedMilliseconds;
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, operation = "windowsAcceptanceSupervisor",
            phase = "sourceHandoffJoint", status, durationMs = elapsedMs, elapsedMs }));
        return firstFailure is null ? 0 : 1;
    }

    private static void ValidateFixturePaths(string root, string directory, string originalTemporaryRoot)
    {
        _ = SourceAdmissionFiles.NativePath(root);
        _ = SourceAdmissionFiles.NativePath(directory);
        var parent = Path.GetDirectoryName(root) ?? throw new InvalidDataException();
        var parentName = Path.GetFileName(parent);
        const string prefix = "eky supervisor ";
        if (Path.GetFileName(root) != "temporary" ||
            !parentName.StartsWith(prefix, StringComparison.Ordinal) || parentName.Length != prefix.Length + 6 ||
            parentName[prefix.Length..].Any(character => !char.IsAsciiLetterOrDigit(character)) ||
            !string.Equals(Path.GetDirectoryName(parent), originalTemporaryRoot, StringComparison.OrdinalIgnoreCase) ||
            Path.GetFileName(directory) != "sourceHandoffJoint")
            throw new InvalidDataException();
        using var fixture = SourceAdmissionFiles.OpenRoot(parent);
        fixture.PinChildDirectory(root);
        fixture.VerifyAll();
        using var assets = SourceAdmissionFiles.OpenRoot(directory);
        foreach (var name in new[] { "sourceHandoffPhase.mjs", "syntheticSource.mjs", "resultPublicationReader.mjs",
            "publicationReadyReader.mjs", "sourceBridgeProtocol.json" })
        {
            if ((File.GetAttributes(Path.Combine(directory, name)) &
                (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device)) != 0)
                throw new InvalidDataException();
        }
        assets.VerifyAll();
        fixture.VerifyAll();
    }
}
