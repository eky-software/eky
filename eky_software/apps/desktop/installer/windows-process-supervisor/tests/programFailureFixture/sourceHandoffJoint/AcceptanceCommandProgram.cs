using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

// Fixed acceptance phases, not a worker-supplied command graph. Node retains
// artifact, business and exact-product decisions; this owner only runs phases.
internal static class AcceptanceCommandProgram
{
    internal static int Run(string[] arguments)
    {
        try
        {
            var measure = Environment.GetEnvironmentVariable("EKY_M51_PASSIVE_SOURCE_MEASUREMENT") == "1";
            if (measure && (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
                Environment.GetEnvironmentVariable("GITHUB_JOB") != "packaged-boundary-diagnostic")) return 64;
            return Run(arguments, null, contractAdmission: measure
                ? new("exit0", prepareReservedRoots: true, measureActualSource: true) : null);
        }
        catch { SafeEvidenceWriter.WriteInvalidRequest("unexpectedFailure"); return 1; }
    }

    internal static int Run(string[] arguments, string? contractWorker,
        Func<string, (int Timeout, int Cleanup)>? contractBudget = null,
        Action<string, bool>? contractPreparation = null,
        SourceAdmissionExperiment? contractAdmission = null)
    {
        var clock = Stopwatch.StartNew();
        var kind = arguments.FirstOrDefault() switch
        {
            "--legacy-command" => "legacy",
            "--clean-command" => "clean",
            "--upgrade-command" => "upgrade",
            "--workspace-success-command" => "workspaceSuccess",
            "--workspace-fault-command" => "workspaceFault",
            _ => null,
        };
        if (kind is null || arguments.Length != (kind == "workspaceFault" ? 11 : 9)) return 64;
        if (contractAdmission is { PrepareReservedRoots: true, MeasureActualSource: false } &&
            (contractWorker is null || kind != "workspaceSuccess")) return 64;
        var input = arguments[1..];
        if (input[0] != "--artifact-descriptor" || input[2] != "--expected-descriptor-sha256" ||
            input[4] != "--expected-build-revision" || input[^2] != "--result-path" ||
            (kind == "workspaceFault" && input[6] != "--fault-scenario") ||
            !IsHex(input[3], 64) || !IsHex(input[5], 40)) return 64;
        if (contractAdmission?.MeasureActualSource == true &&
            (contractWorker is not null || kind != "workspaceFault" || input[7] != "passiveWorkspaceMigrationFailure")) return 64;
        var scenario = kind switch
        {
            "legacy" => "historicalLegacyUpgrade",
            "clean" => "cleanInstallUninstall",
            "upgrade" => "upgradeRollback",
            "workspaceSuccess" => "packagedWorkspaceSuccess",
            _ => "packagedWorkspaceFaultRollback",
        };
        using var budgetStream = typeof(AcceptanceCommandProgram).Assembly.GetManifestResourceStream("supervisorCommandBudgets.json")!;
        using var budgets = JsonDocument.Parse(budgetStream);
        var exitReserve = budgets.RootElement.GetProperty("exitReserveMilliseconds").GetInt32();
        var plan = budgets.RootElement.GetProperty(kind switch {
            "legacy" => "legacyCommand", "clean" => "cleanCommand", "upgrade" => "upgradeCommand", _ => "workspaceCommand" });
        var deadline = plan.GetProperty("reservationMilliseconds").GetInt32();
        var phases = plan.GetProperty("phases").EnumerateArray().Select(value =>
            (Name: value[0].GetString()!, Timeout: value[1].GetInt32(), Cleanup: value[2].GetInt32())).ToArray();
        var preparation = phases.Single(phase => phase.Name == "prepare");
        var context = new CommandContext(
            Path.Combine(Path.GetTempPath(), "eky-acceptance-command-" + Guid.NewGuid().ToString("N")),
            input, kind, scenario, NewNonce(), contractWorker, contractPreparation,
            preparation.Timeout - preparation.Cleanup, contractAdmission,
            phases.TakeWhile(phase => phase.Name != "scenario").Select(phase => phase.Name).ToArray());
        var publication = phases[^1];
        var publicationBudget = contractBudget?.Invoke("publish") ?? (publication.Timeout, publication.Cleanup);
        var failed = false;
        SafeEvidenceWriter? evidence = null;
        try
        {
            try { evidence = new SafeEvidenceWriter(scenario, clock); } catch { /* Optional diagnostics. */ }
            foreach (var phase in phases)
            {
                var phaseBudget = contractBudget?.Invoke(phase.Name) ?? (phase.Timeout, phase.Cleanup);
                var timeout = CalculatePhaseTimeout(deadline, clock.ElapsedMilliseconds, exitReserve,
                    phaseBudget.Timeout, publicationBudget.Timeout, phase.Name == "publish");
                var cleanup = phaseBudget.Cleanup;
                if (timeout <= cleanup) return PublishFailure(context,
                    (int)Math.Min(publicationBudget.Timeout, deadline - clock.ElapsedMilliseconds - exitReserve), publicationBudget.Cleanup, evidence);
                var nonce = phase.Name == "scenario" ? context.ScenarioRunNonce : NewNonce();
                evidence?.Write(phase.Name, "started");
                var completion = RunPhase(context, phase.Name, nonce, timeout, cleanup, evidence);
                context.History.Add(new { phase = phase.Name, runNonce = nonce, exitCode = completion.ExitCode,
                    resultWritten = completion.ResultWritten, processBoundaryVerified = completion.ProcessBoundaryVerified,
                    requestErrorCode = completion.RequestErrorCode });
                evidence?.Write(phase.Name, completion.ExitCode == 0 ? "completed" : "failed");
                // Pending host I/O or unverified process cleanup forbids every
                // continuation. Retain evidence and exit; no emergency fallback.
                if (!completion.ProcessBoundaryVerified) return 1;
                if (phase.Name == "scenario" && contractAdmission is { MeasureActualSource: false })
                {
                    // Explicit private checkpoint, NOT a successful fixed command.
                    contractAdmission.BoundedStopAfterScenario = completion.ExitCode == 0 && completion.ResultWritten &&
                        contractAdmission.PreparationFinished.IsSet && contractAdmission.DeferredRelease.IsCompleted &&
                        contractAdmission.Current is { AllHandlesClosed: true } && contractAdmission.CleanupFailure is null;
                    return 1;
                }
                failed |= completion.ExitCode != 0;
                if (phase.Name == "publish") return failed ? 1 : 0;
                if (completion.ExitCode != 0 && phase.Name != "scenario")
                    return PublishFailure(context,
                        (int)Math.Min(publicationBudget.Timeout, deadline - clock.ElapsedMilliseconds - exitReserve),
                        publicationBudget.Cleanup, evidence);
            }
            return failed ? 1 : 0;
        }
        finally
        {
            context.ReleaseUnusedPreparation();
            evidence?.CompleteWithinRequestBudget(0);
        }
    }

    internal static int CalculatePhaseTimeout(int commandReservation, long elapsed, int exitReserve,
        int phaseTimeout, int publicationTimeout, bool publishing)
    {
        var remaining = commandReservation - elapsed - exitReserve -
            (publishing ? 0 : publicationTimeout + exitReserve);
        return (int)Math.Min(phaseTimeout, remaining);
    }

    internal static int CalculatePreparationTimeout(int phaseTimeout, int cleanupReserve, int normalWorkCap) =>
        Math.Max(0, Math.Min(normalWorkCap, phaseTimeout - cleanupReserve));

    private static int PublishFailure(CommandContext context, int timeout, int cleanup, SafeEvidenceWriter? evidence)
    {
        if (timeout > cleanup) _ = RunPhase(context, "publishFailure", NewNonce(), timeout, cleanup, evidence);
        return 1;
    }

    private static SupervisorPhaseCompletion RunPhase(CommandContext context, string phase, string nonce, int timeout, int cleanup,
        SafeEvidenceWriter? evidence)
    {
        var ownershipGate = new object();
        var preparationClosed = false;
        WorkspaceSourceAdmission? pending = null;
        var proof = phase == "scenario" ? context.ContractAdmission : null;
        context.LastPhaseSettled = false;
        try
        {
            var completion = SupervisorProgram.RunPhase(observe =>
        {
            WorkspaceSourceAdmission? local = null;
            try
            {
            context.ContractPreparation?.Invoke(phase, false);
            observe(SupervisorRequestPreparationPhase.TemporaryRootCheck, false);
            if (!Directory.Exists(Path.GetTempPath())) throw new SupervisorFailure("requestWorkingDirectoryInvalid");
            observe(SupervisorRequestPreparationPhase.TemporaryRootCheck, true);
            var phaseRoot = Path.Combine(context.Root, phase);
            observe(SupervisorRequestPreparationPhase.PhaseDirectoryCreation, false);
            Directory.CreateDirectory(phaseRoot);
            var reservedRoot = context.ReserveWorkspacePreparation(phase);
            observe(SupervisorRequestPreparationPhase.PhaseDirectoryCreation, true);
            var inputPath = Path.Combine(phaseRoot, "phase-input.json");
            observe(SupervisorRequestPreparationPhase.PhaseInputWrite, false);
            WriteExclusive(inputPath, new { schemaVersion = 1, phase, commandKind = context.Kind,
                scenarioRunNonce = context.ScenarioRunNonce, commandArguments = context.Input, history = context.History });
            observe(SupervisorRequestPreparationPhase.PhaseInputWrite, true);
            var requestPath = Path.Combine(phaseRoot, "request.json");
            var harnessRoot = context.ContractAdmission?.MeasureActualSource == true
                ? "../../../../../windows-acceptance-harness" : "../../../../windows-acceptance-harness";
            var worker = context.ContractWorker ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
                harnessRoot, context.Kind switch {
                    "legacy" => "legacyCommandPhase.mjs", "clean" => "cleanCommandPhase.mjs",
                    "upgrade" => "upgradeCommandPhase.mjs", _ => "workspaceCommandPhase.mjs" }));
            if (context.ContractAdmission?.MeasureActualSource == true && reservedRoot is not null)
                worker = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
                    "../../../../../windows-process-supervisor/tests/programFailureFixture/sourceHandoffJoint/workspaceSourceMeasurementPhase.mjs"));
            observe(SupervisorRequestPreparationPhase.NodeExecutableResolution, false);
            var command = ResolveNodeExecutable();
            observe(SupervisorRequestPreparationPhase.NodeExecutableResolution, true);
            observe(SupervisorRequestPreparationPhase.RequestWrite, false);
            WriteExclusive(requestPath, new { schemaVersion = 1, runNonce = nonce,
                scenario = phase == "scenario" ? context.Scenario : "acceptanceCommandPhase",
                artifactDescriptorSha256 = context.Input[3], command,
                arguments = reservedRoot is null ? new[] { worker, "--phase-request", inputPath }
                    : new[] { worker, "--phase-request", inputPath, "--reserved-run-root", reservedRoot }, workingDirectory = phaseRoot,
                timeoutMilliseconds = timeout, cleanupReserveMilliseconds = cleanup }, observe);
            observe(SupervisorRequestPreparationPhase.RequestWrite, true);
            var request = SupervisorRequestReader.Read(["--request", requestPath], observe);
            context.ContractPreparation?.Invoke(phase, true);
            if (proof is not null)
            {
                var anchors = new SourceAdmissionAnchors(context.Root, context.Kind, context.Scenario,
                    context.ScenarioRunNonce, context.Input[3], context.Input[5],
                    context.Kind == "workspaceFault" ? context.Input[7] : null,
                    context.SourcePrefix, JsonSerializer.SerializeToElement(context.History));
                proof.BeforeAdmission?.Invoke(anchors);
                local = proof.PrepareReservedRoots
                    ? WorkspaceSourceAdmission.ReadReserved(anchors, proof, context.TakePreparation())
                    : WorkspaceSourceAdmission.Read(anchors, proof);
                lock (ownershipGate)
                {
                    if (preparationClosed)
                    {
                        proof.LateAuthorityRejected = true;
                        throw new SupervisorFailure("processStateInvalid");
                    }
                    pending = local;
                    local = null;
                    proof.Published = true;
                }
            }
            return request;
            }
            catch (Exception error) { proof?.ObserveFirst(error); throw; }
            finally
            {
                if (local is not null) Close(local, proof!);
                proof?.PreparationFinished.Set();
            }
        }, execute: (request, clock, phaseEvidence) =>
        {
            WorkspaceSourceAdmission? owned;
            lock (ownershipGate) { owned = pending; pending = null; }
            if (proof is null)
                return new WindowsJobProcessSupervisor(clock, phaseEvidence).Run(request);
            if (owned is null) throw new SupervisorFailure("processStateInvalid");
            proof.Consumed++;
            WindowsJobProcessSupervisor? owner = null;
            SourceReservationFixture? reservation = null;
            var releasePending = false;
            var releaseScheduled = false;
            var processOwnerEntered = false;
            SupervisorOutcome outcome;
            try
            {
            if (proof.Case is not ("exit0" or "sourceHold")) throw new SupervisorFailure("processStateInvalid");
            var source = SourceHandoffContext.Create(SourceBridgeProtocol.Read(), proof, request, owned,
                proof.MeasureActualSource ? null :
                    Path.Combine(proof.FixtureDirectory ?? throw new SupervisorFailure("processStateInvalid"), "syntheticSource.mjs"));
            if (!proof.MeasureActualSource)
            {
                reservation = new SourceReservationFixture(request, clock, proof);
                proof.SourceReservationCloseRequested = reservation.ObserveSourceAdmissionCloseRequested;
                reservation.Start();
                reservation.WaitForEntry();
            }
            owner = new WindowsJobProcessSupervisor(clock, phaseEvidence, sourceContext: source,
                observeMsiActivity: proof.MeasureActualSource ? null : _ => WorkspaceMsiMembership.None,
                createProcess: (selection, job, cancellation) =>
            {
                try
                {
                    cancellation.ThrowIfCancellationRequested();
                    proof.BeforeCreation?.Invoke(owned);
                    owned.Verify();
                    cancellation.ThrowIfCancellationRequested();
                    var child = SuspendedWindowsProcess.Start(selection, job, cancellation);
                    Interlocked.Increment(ref proof.WorkerStarts);
                    return child;
                }
                catch (Exception error) { proof.ObserveFirst(error); throw; }
            });
            reservation?.ObserveOwnerStart();
            processOwnerEntered = true;
            outcome = owner.Run(request);
            }
            catch (Exception error)
            {
                proof.ObserveFirst(error);
                reservation?.ObserveFailure(error);
                ReleaseAfterCreation(null);
                proof.SourceProof = owner?.SourceProof;
                proof.ReservationProof = reservation?.Snapshot();
                var failed = SupervisorOutcome.Failed(error is TimeoutException ? "deadlineExceeded" :
                    (error as SupervisorFailure)?.ErrorCode ?? "processStateInvalid", "cleanupUnverified", false,
                    processWin32ErrorCode: (error as SupervisorFailure)?.Win32ErrorCode ?? (error as Win32Exception)?.NativeErrorCode)
                    with { HostOperationsCompleted = false };
                proof.FinalOwnerOutcome = failed;
                return failed;
            }
            ReleaseAfterCreation(outcome);
            proof.SourceProof = owner?.SourceProof;
            proof.ReservationProof = reservation?.Snapshot();
            var requiredResourcesSettled = !releasePending && proof.DeferredRelease.IsCompletedSuccessfully &&
                owner?.LateCreationRelease.IsCompletedSuccessfully == true &&
                owned.AllHandlesClosed && (proof.MeasureActualSource ||
                    reservation is { ResourcesSettled: true } &&
                    (proof.Case == "exit0" ? reservation.ExchangeSucceeded : reservation.CloseReleaseProved));
            var finalOutcome = ProjectReservationCompletion(outcome, requiredResourcesSettled, proof.CleanupFailure is not null);
            proof.FinalOwnerOutcome = finalOutcome;
            return finalOutcome;

            void ReleaseAfterCreation(SupervisorOutcome? exitEvidence)
            {
                if (releaseScheduled) return;
                releaseScheduled = true;
                reservation?.Stop();
                var release = Task.WhenAll(owner?.LateCreationRelease ?? Task.CompletedTask,
                    reservation?.Work ?? Task.CompletedTask);
                // Final proof reads and all closes are themselves tracked host I/O.
                proof.DeferredRelease = release.ContinueWith(completed => CompleteRelease(completed, exitEvidence),
                    CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);
                new StopwatchSupervisorDeadline(clock).WaitForTask(proof.DeferredRelease, request.TimeoutMilliseconds);
                releasePending = !proof.DeferredRelease.IsCompletedSuccessfully;
                if (proof.DeferredRelease.Exception is not null) proof.ObserveCleanup(proof.DeferredRelease.Exception);
                proof.ReservationProof = reservation?.Snapshot();
            }

            void CompleteRelease(Task completed, SupervisorOutcome? exitEvidence)
            {
                if (completed.Exception is not null) proof.ObserveCleanup(completed.Exception);
                // A drained host task cannot establish that the Job stopped using these pins.
                if ((proof.PrepareReservedRoots || proof.MeasureActualSource) &&
                    !CanReleasePreparedAdmission(processOwnerEntered, exitEvidence, completed.IsCompletedSuccessfully)) return;
                try { reservation?.CaptureWorkerContinuation(); }
                catch (Exception error) { reservation?.ObserveFailure(error); }
                finally
                {
                    // Both owners have settled before any control pin or admission is released.
                    try { reservation?.CloseControls(); }
                    catch (Exception error) { proof.ObserveCleanup(error); }
                    finally
                    {
                        Close(owned, proof);
                        proof.SourceProof = owner?.SourceProof;
                        proof.ReservationProof = reservation?.Snapshot();
                    }
                }
            }
        }, commandEvidence: evidence, preparationTimeoutMilliseconds:
            CalculatePreparationTimeout(timeout, cleanup, context.PreparationWorkCap));
            context.LastPhaseSettled = completion.ProcessBoundaryVerified;
            if (proof is not null) proof.ScenarioBoundaryVerified = completion.ProcessBoundaryVerified;
            return completion;
        }
        finally
        {
            WorkspaceSourceAdmission? unused;
            lock (ownershipGate) { preparationClosed = true; unused = pending; pending = null; }
            if (unused is not null) Close(unused, proof!);
        }
    }

    internal static bool CanReleasePreparedAdmission(bool processOwnerEntered, SupervisorOutcome? exitEvidence,
        bool hostWorkSettled) => hostWorkSettled && (!processOwnerEntered ||
        exitEvidence is { ProcessTreeAbsent: true, HostOperationsCompleted: true });

    // Exchange/observation success is not process or resource-settlement evidence.
    internal static SupervisorOutcome ProjectReservationCompletion(SupervisorOutcome original,
        bool requiredResourcesSettled, bool cleanupFailed)
    {
        if (requiredResourcesSettled && !cleanupFailed) return original;
        return original with
        {
            Status = "failed",
            ProcessResultCode = original.Status == "failed" ? original.ProcessResultCode : "processStateInvalid",
            WorkerResultCode = original.Status == "failed" ? original.WorkerResultCode : "notChecked",
            CleanupResultCode = cleanupFailed || original.CleanupResultCode == "cleanupFailed"
                ? "cleanupFailed" : "cleanupUnverified",
            ProcessTreeAbsent = false,
            HostOperationsCompleted = false,
        };
    }

    // One private coexistence fixture; it borrows the phase clock and owns no process tree.
    private sealed class SourceReservationFixture(SupervisorRequest request, Stopwatch clock, SourceAdmissionExperiment proof)
    {
        private readonly string controlsRoot = Path.Combine(request.WorkingDirectory, request.RunNonce);
        private readonly List<FileStream> streams = [];
        private readonly List<SafeFileHandle> handles = [];
        private readonly object stateGate = new();
        private SafeFileHandle? controlPin;
        private FileInformation controlIdentity;
        private volatile bool stopped;
        private bool entered, entryReady, exchangeCompleted, returned, ownerStarted, resourcesReleased;
        private bool? workerContinuationObserved;
        private long? enteredAtMs, ownerStartedAtMs;
        private readonly ManualResetEventSlim nativeCloseRelease = new(false);
        private int callbackActive, nativeCloseObserved, reservationHeldAtNativeClose, releaseAfterNativeClose, unwindRelease;
        private long nativeCloseAtMs = -1, callbackReleasedAtMs = -1, callbackReturnedAtMs = -1;
        private bool closeSignalDisposed;
        private string publication = "notStarted";
        private JsonElement? actualEvidenceBinding;
        private int? actualEvidenceBytes;
        private string? actualEvidenceSha256;
        private Exception? firstFailure;
        private readonly List<Exception> cleanupFailures = [];
        internal Task Work { get; private set; } = Task.CompletedTask;
        internal bool ResourcesSettled
        {
            get
            {
                lock (stateGate) return Work.IsCompletedSuccessfully && resourcesReleased && closeSignalDisposed &&
                    (controlPin is null || controlPin.IsClosed) && cleanupFailures.Count == 0 &&
                    handles.All(handle => handle.IsClosed);
            }
        }
        internal bool CloseReleaseProved
        {
            get
            {
                lock (stateGate) return proof.Case == "sourceHold" && Work.IsCompletedSuccessfully &&
                    Volatile.Read(ref nativeCloseObserved) != 0 && Volatile.Read(ref reservationHeldAtNativeClose) != 0 &&
                    Volatile.Read(ref releaseAfterNativeClose) != 0 && Volatile.Read(ref unwindRelease) == 0 &&
                    Interlocked.Read(ref nativeCloseAtMs) >= 0 &&
                    Interlocked.Read(ref callbackReleasedAtMs) >= Interlocked.Read(ref nativeCloseAtMs) &&
                    Interlocked.Read(ref callbackReturnedAtMs) >= Interlocked.Read(ref callbackReleasedAtMs) &&
                    Interlocked.Read(ref callbackReturnedAtMs) < request.TimeoutMilliseconds &&
                    workerContinuationObserved == false;
            }
        }

        internal bool ExchangeSucceeded
        {
            get
            {
                lock (stateGate) return entered && entryReady && ownerStarted && exchangeCompleted && returned &&
                    publication == "recorded" && actualEvidenceBinding.HasValue && firstFailure is null &&
                    workerContinuationObserved == true;
            }
        }

        internal void Start()
        {
            proof.Stage = "sourceReservation";
            Active();
            Work = Task.Run(() =>
            {
                try
                {
                    Active();
                    if (!CreateDirectory(SourceAdmissionFiles.NativePath(controlsRoot), IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                    controlPin = OpenExisting(controlsRoot, directory: true)!;
                    controlIdentity = Validate(controlPin, controlsRoot, directory: true);
                    VerifyControls();
                    Active();
                    var evidence = new MsiWindowEvidence(request, () =>
                    {
                        Volatile.Write(ref callbackActive, 1);
                        try
                        {
                            lock (stateGate) { entered = true; enteredAtMs = clock.ElapsedMilliseconds; }
                            Active();
                            VerifyControls();
                            Marker("reservation-entered.ready");
                            lock (stateGate) entryReady = true;
                            if (proof.Case == "sourceHold")
                            {
                                // Only the real CloseAdmission hook releases this reservation.
                                nativeCloseRelease.Wait();
                                if (Volatile.Read(ref nativeCloseObserved) == 0 ||
                                    Volatile.Read(ref reservationHeldAtNativeClose) == 0 ||
                                    Volatile.Read(ref unwindRelease) != 0)
                                    throw new OperationCanceledException("sourceReservationUnwindRelease");
                                if (clock.ElapsedMilliseconds >= request.TimeoutMilliseconds)
                                    throw new TimeoutException("sourceReservationCleanupDeadline");
                                throw new OperationCanceledException("sourceReservationAdmissionClosed");
                            }
                            for (;;)
                            {
                                Active();
                                if (ReadMarker("exchange-completed.release"))
                                {
                                    Active();
                                    Interlocked.Exchange(ref callbackReleasedAtMs, clock.ElapsedMilliseconds);
                                    lock (stateGate) exchangeCompleted = true;
                                    break;
                                }
                                Thread.Sleep((int)Math.Clamp(WorkDeadline - clock.ElapsedMilliseconds, 1, 20));
                            }
                        }
                        catch (Exception error) { ObserveFailure(error); throw; }
                        finally
                        {
                            Interlocked.Exchange(ref callbackReturnedAtMs, clock.ElapsedMilliseconds);
                            Volatile.Write(ref callbackActive, 0);
                        }
                    });
                    var result = evidence.Publish([], clock.ElapsedMilliseconds,
                        () => stopped || clock.ElapsedMilliseconds >= WorkDeadline);
                    lock (stateGate) publication = result;
                    if (result != "recorded") throw new InvalidDataException("sourceReservationNotRecorded");
                    Active();
                    ReadEvidenceBinding();
                    Active();
                    Marker("reservation-returned.ready");
                    lock (stateGate) returned = true;
                }
                catch (Exception error) { ObserveFailure(error); }
            });
        }

        private long WorkDeadline => request.TimeoutMilliseconds - request.CleanupReserveMilliseconds;
        private void Active()
        {
            if (stopped) throw new OperationCanceledException("sourceReservationStopped");
            if (clock.ElapsedMilliseconds >= WorkDeadline) throw new TimeoutException("sourceReservationDeadline");
        }

        internal void WaitForEntry()
        {
            for (;;)
            {
                Active();
                lock (stateGate)
                {
                    if (firstFailure is not null || Work.IsCompleted)
                        throw new SupervisorFailure("processStateInvalid");
                    if (entryReady) return;
                }
                Thread.Sleep((int)Math.Clamp(WorkDeadline - clock.ElapsedMilliseconds, 1, 20));
            }
        }

        internal void ObserveOwnerStart()
        {
            Active();
            lock (stateGate)
            {
                if (!entryReady || firstFailure is not null || Work.IsCompleted || exchangeCompleted)
                    throw new SupervisorFailure("processStateInvalid");
                ownerStarted = true;
                ownerStartedAtMs = clock.ElapsedMilliseconds;
            }
        }

        internal void ObserveSourceAdmissionCloseRequested(long elapsedMilliseconds)
        {
            if (Interlocked.CompareExchange(ref nativeCloseObserved, 1, 0) != 0) return;
            Interlocked.Exchange(ref nativeCloseAtMs, elapsedMilliseconds);
            var held = Volatile.Read(ref callbackActive) != 0 && !Work.IsCompleted;
            Volatile.Write(ref reservationHeldAtNativeClose, held ? 1 : 0);
            if (proof.Case != "sourceHold") return;
            Interlocked.Exchange(ref callbackReleasedAtMs, clock.ElapsedMilliseconds);
            nativeCloseRelease.Set();
            if (held) Volatile.Write(ref releaseAfterNativeClose, 1);
        }

        internal void Stop()
        {
            stopped = true;
            if (proof.Case == "sourceHold" && !nativeCloseRelease.IsSet)
            {
                Volatile.Write(ref unwindRelease, 1);
                nativeCloseRelease.Set();
            }
        }
        internal void ObserveFailure(Exception error)
        {
            lock (stateGate) firstFailure ??= error;
            proof.ObserveFirst(error);
        }
        private void ObserveCleanup(Exception error)
        {
            lock (stateGate) cleanupFailures.Add(error);
            proof.ObserveCleanup(error);
        }

        private FileStream Own(FileStream file)
        {
            streams.Add(file);
            handles.Add(file.SafeFileHandle);
            return file;
        }

        private void Use(FileStream file, Action<FileStream> action)
        {
            try { action(file); }
            catch (Exception error)
            {
                SourceHandoffPrototype.CloseFailedMailboxOpen(error, file, ObserveFailure, ObserveCleanup);
                throw;
            }
            try { file.Dispose(); }
            catch (Exception error) { ObserveCleanup(error); throw; }
        }

        private SafeFileHandle? OpenExisting(string path, bool directory = false, bool optional = false,
            bool busyIsNotReady = true)
        {
            var handle = CreateFile(SourceAdmissionFiles.NativePath(path), directory ? 0x81u : 0x80000000u, 1, IntPtr.Zero, 3,
                directory ? 0x02200000u : 0x00200000u, IntPtr.Zero);
            var error = handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
            handles.Add(handle);
            if (error != 0)
            {
                handle.Dispose();
                if (optional && (error == 2 || busyIsNotReady && error == 32)) return null;
                throw new Win32Exception(error);
            }
            try { Validate(handle, path, directory); return handle; }
            catch (Exception primary)
            {
                SourceHandoffPrototype.CloseFailedMailboxOpen(primary, handle, ObserveFailure, ObserveCleanup);
                throw;
            }
        }

        private void VerifyControls()
        {
            if (controlPin is null || controlPin.IsClosed) throw new InvalidDataException("sourceReservationPinMissing");
            var held = Validate(controlPin, controlsRoot, directory: true);
            if (!SameFile(controlIdentity, held)) throw new InvalidDataException("sourceReservationPinChanged");
            var current = OpenExisting(controlsRoot, directory: true)!;
            try
            {
                if (!SameFile(controlIdentity, Validate(current, controlsRoot, directory: true)))
                    throw new InvalidDataException("sourceReservationPathChanged");
            }
            catch (Exception primary)
            {
                SourceHandoffPrototype.CloseFailedMailboxOpen(primary, current, ObserveFailure, ObserveCleanup);
                throw;
            }
            try { current.Dispose(); }
            catch (Exception error) { ObserveCleanup(error); throw; }
        }

        private void Marker(string name)
        {
            Active();
            VerifyControls();
            var path = Path.Combine(controlsRoot, name);
            Use(Own(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)), file =>
            {
                Validate(file.SafeFileHandle, path);
                if (file.Length != 0) throw new InvalidDataException("sourceReservationMarkerNotEmpty");
                Active();
                VerifyControls();
            });
            Active();
        }

        private bool ReadMarker(string name, bool busyIsNotReady = true)
        {
            VerifyControls();
            var path = Path.Combine(controlsRoot, name);
            var handle = OpenExisting(path, optional: true, busyIsNotReady: busyIsNotReady);
            if (handle is null) return false;
            FileStream file;
            try { file = Own(new FileStream(handle, FileAccess.Read)); }
            catch (Exception primary)
            {
                SourceHandoffPrototype.CloseFailedMailboxOpen(primary, handle, ObserveFailure, ObserveCleanup);
                throw;
            }
            Use(file, input =>
            {
                if (input.Length != 0 || input.ReadByte() != -1)
                    throw new InvalidDataException("sourceReservationMarkerNotEmpty");
                Validate(input.SafeFileHandle, path);
                VerifyControls();
            });
            return true;
        }

        private void ReadEvidenceBinding()
        {
            var path = Path.Combine(Path.GetDirectoryName(request.ResultPath)!,
                MsiWindowObservation.Contract.FilenamePrefix + "001.private.json");
            var handle = OpenExisting(path)!;
            FileStream file;
            try { file = Own(new FileStream(handle, FileAccess.Read)); }
            catch (Exception primary)
            {
                SourceHandoffPrototype.CloseFailedMailboxOpen(primary, handle, ObserveFailure, ObserveCleanup);
                throw;
            }
            Use(file, input =>
            {
                if (input.Length < 2 || input.Length > MsiWindowObservation.Contract.MaximumBytes)
                    throw new InvalidDataException("sourceReservationEvidenceSize");
                var length = checked((int)input.Length);
                var bytes = new byte[length];
                input.ReadExactly(bytes);
                if (input.ReadByte() != -1 || input.Length != length)
                    throw new InvalidDataException("sourceReservationEvidenceChanged");
                using var document = JsonDocument.Parse(bytes);
                var row = document.RootElement;
                if (row.GetProperty("schemaVersion").GetInt32() != MsiWindowObservation.Contract.SchemaVersion ||
                    row.GetProperty("operation").GetString() != MsiWindowObservation.Contract.Operation ||
                    row.GetProperty("runNonce").GetString() != request.RunNonce ||
                    row.GetProperty("scenario").GetString() != request.Scenario ||
                    row.GetProperty("artifactDescriptorSha256").GetString() != request.ArtifactDescriptorSha256 ||
                    row.GetProperty("sequence").GetInt32() != 1)
                    throw new InvalidDataException("sourceReservationEvidenceBinding");
                Validate(input.SafeFileHandle, path);
                VerifyControls();
                lock (stateGate)
                {
                    actualEvidenceBinding = row.Clone();
                    actualEvidenceBytes = length;
                    actualEvidenceSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                }
            });
        }

        internal void CaptureWorkerContinuation()
        {
            if (!Work.IsCompleted) throw new InvalidOperationException("sourceReservationStillPending");
            if (controlPin is null) return;
            var observed = ReadMarker("worker-continuation.ready", busyIsNotReady: false);
            lock (stateGate) workerContinuationObserved = observed;
            if (proof.Case == "exit0" && !observed || proof.Case == "sourceHold" && observed)
                throw new InvalidDataException("sourceReservationWorkerContinuationUnexpected");
        }

        internal void CloseControls()
        {
            if (!Work.IsCompleted) throw new InvalidOperationException("sourceReservationStillPending");
            foreach (var stream in streams)
                try { stream.Dispose(); } catch (Exception error) { ObserveCleanup(error); }
            foreach (var handle in handles.AsEnumerable().Reverse())
                try { handle.Dispose(); } catch (Exception error) { ObserveCleanup(error); }
            try { nativeCloseRelease.Dispose(); closeSignalDisposed = true; }
            catch (Exception error) { ObserveCleanup(error); }
            proof.SourceReservationCloseRequested = null;
            lock (stateGate) resourcesReleased = true;
        }

        internal object Snapshot()
        {
            lock (stateGate) return new
            {
                entered, entryReady, enteredAtMs, ownerStarted, ownerStartedAtMs,
                nativeCloseObserved = Volatile.Read(ref nativeCloseObserved) != 0,
                nativeCloseAtMs = Interlocked.Read(ref nativeCloseAtMs) < 0 ? (long?)null : Interlocked.Read(ref nativeCloseAtMs),
                reservationHeldAtNativeClose = Volatile.Read(ref reservationHeldAtNativeClose) != 0,
                callbackReleasedAtMs = Interlocked.Read(ref callbackReleasedAtMs) < 0 ? (long?)null : Interlocked.Read(ref callbackReleasedAtMs),
                callbackReturnedAtMs = Interlocked.Read(ref callbackReturnedAtMs) < 0 ? (long?)null : Interlocked.Read(ref callbackReturnedAtMs),
                releaseAfterNativeClose = Volatile.Read(ref releaseAfterNativeClose) != 0,
                unwindRelease = Volatile.Read(ref unwindRelease) != 0,
                exchangeCompleted, publication, returned, taskSettled = Work.IsCompleted,
                pinClosed = controlPin?.IsClosed ?? false, resourcesReleased,
                allControlHandlesClosed = resourcesReleased && handles.All(handle => handle.IsClosed),
                reservationResourcesSettled = ResourcesSettled, exchangeSucceeded = ExchangeSucceeded,
                workerContinuationObserved, actualEvidenceBinding, actualEvidenceBytes, actualEvidenceSha256,
                firstFailure = Describe(firstFailure), cleanupFailures = cleanupFailures.Select(Describe).ToArray(),
                optionalMsiObserver = "none", scope = "realEvidenceReservationSyntheticSourceTransport",
                lateFrameAuthorityProved = false, fullCommandAccepted = false,
            };
        }

        private static object? Describe(Exception? error) => error is null ? null : new
        {
            type = error.GetType().Name, error.HResult,
            nativeError = (error as Win32Exception)?.NativeErrorCode,
        };
        private static bool SameFile(FileInformation left, FileInformation right) =>
            left.VolumeSerialNumber == right.VolumeSerialNumber && left.IndexHigh == right.IndexHigh &&
            left.IndexLow == right.IndexLow && left.CreationTime.Equals(right.CreationTime);

        private static FileInformation Validate(SafeFileHandle file, string path, bool directory = false)
        {
            if (!GetFileInformationByHandle(file, out var information))
                throw new IOException("mailboxFileInformationFailed", new Win32Exception(Marshal.GetLastWin32Error()));
            var kind = information.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device);
            if (directory ? kind != FileAttributes.Directory : kind != 0 || information.NumberOfLinks != 1)
                throw new InvalidDataException("mailboxFileIdentityInvalid");
            var final = new StringBuilder(32_768);
            var length = GetFinalPathNameByHandle(file, final, (uint)final.Capacity, 0);
            if (length == 0) throw new IOException("mailboxFinalPathFailed", new Win32Exception(Marshal.GetLastWin32Error()));
            if (length >= final.Capacity || !string.Equals(Path.TrimEndingDirectorySeparator(final.ToString()),
                "\\\\?\\" + Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("mailboxFinalPathInvalid");
            return information;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FileInformation
        {
            internal FileAttributes Attributes;
            internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
            internal uint VolumeSerialNumber, SizeHigh, SizeLow, NumberOfLinks, IndexHigh, IndexLow;
        }
        [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateDirectory(string path, IntPtr security);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
        [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
            uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags);
    }

    private static void Close(WorkspaceSourceAdmission admission, SourceAdmissionExperiment proof)
    {
        try { admission.Dispose(); }
        catch (Exception error) { proof.ObserveCleanup(error); }
    }

    private sealed record CommandContext(string Root, string[] Input, string Kind, string Scenario,
        string ScenarioRunNonce, string? ContractWorker, Action<string, bool>? ContractPreparation,
        int PreparationWorkCap, SourceAdmissionExperiment? ContractAdmission, IReadOnlyList<string> SourcePrefix)
    {
        internal List<object> History { get; } = [];
        internal bool LastPhaseSettled { get; set; }
        private SourceAdmissionFiles? preparation;
        private string? tempRoot, runRoot;

        // Only the bounded alternate test command calls this. Phase preparation
        // owns all mutations; the command loop advances only after its boundary.
        internal string? ReserveWorkspacePreparation(string phase)
        {
            if (ContractAdmission?.PrepareReservedRoots != true || phase is not ("prepare" or "scenarioPreparation" or "scenario")) return null;
            if (phase == "prepare")
            {
                if (preparation is not null || runRoot is not null) throw new SupervisorFailure("processStateInvalid");
                tempRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
                preparation = SourceAdmissionFiles.OpenRoot(tempRoot);
                var name = SourceBootstrapProjection.Read().WorkspaceRunRootPrefix + NewNonce()[..6];
                var path = Path.Combine(tempRoot, name);
                preparation.CreateReservedChildDirectory(path);
                runRoot = path;
            }
            else if (phase == "scenarioPreparation")
            {
                if (preparation is null || runRoot is null || tempRoot is null) throw new SupervisorFailure("processStateInvalid");
                preparation.CreateReservedChildDirectory(Path.Combine(runRoot, "scenario"));
                preparation.VerifyCreatedPreparation(tempRoot, runRoot);
            }
            else if (preparation is null || runRoot is null) throw new SupervisorFailure("processStateInvalid");
            return runRoot;
        }

        internal SourceAdmissionFiles TakePreparation()
        {
            var owned = preparation ?? throw new SupervisorFailure("processStateInvalid");
            preparation = null;
            return owned;
        }

        internal void ReleaseUnusedPreparation()
        {
            // A timed-out phase may still be using the scope. Do not dispose,
            // remove the fixture, or assert settlement on its behalf.
            if (!LastPhaseSettled || preparation is null) return;
            try { TakePreparation().Dispose(); }
            catch (Exception error) { ContractAdmission?.ObserveCleanup(error); }
        }
    }

    private static string NewNonce() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
    private static bool IsHex(string value, int length) => value.Length == length &&
        value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static string ResolveNodeExecutable()
    {
        var supplied = Environment.GetEnvironmentVariable("npm_node_execpath");
        if (!string.IsNullOrEmpty(supplied))
        {
            if (!Path.IsPathFullyQualified(supplied)) throw new SupervisorFailure("requestCommandInvalid");
            return supplied;
        }
        // pnpm exec does not populate npm_node_execpath. Resolve only the fixed
        // Node tool from absolute PATH entries, never an input command or shell.
        foreach (var entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            var directory = entry.Trim('"');
            if (!Path.IsPathFullyQualified(directory)) continue;
            var candidate = Path.Combine(directory, "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new SupervisorFailure("requestCommandInvalid");
    }

    internal static void WriteExclusive(string path, object value,
        Action<SupervisorRequestPreparationPhase, bool>? observe = null)
    {
        void Observe(SupervisorRequestPreparationPhase phase, bool completed)
        {
            try { observe?.Invoke(phase, completed); } catch { /* Optional observation only. */ }
        }
        Observe(SupervisorRequestPreparationPhase.RequestFileCreate, false);
        using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            Observe(SupervisorRequestPreparationPhase.RequestFileCreate, true);
            Observe(SupervisorRequestPreparationPhase.RequestSerialize, false);
            JsonSerializer.Serialize(stream, value);
            Observe(SupervisorRequestPreparationPhase.RequestSerialize, true);
            Observe(SupervisorRequestPreparationPhase.RequestFlush, false);
            stream.Flush(true);
            Observe(SupervisorRequestPreparationPhase.RequestFlush, true);
            Observe(SupervisorRequestPreparationPhase.RequestClose, false);
        }
        Observe(SupervisorRequestPreparationPhase.RequestClose, true);
    }
}
