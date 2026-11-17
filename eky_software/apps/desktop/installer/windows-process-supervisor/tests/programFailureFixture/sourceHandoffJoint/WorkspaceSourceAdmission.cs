using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

internal sealed record SourceAdmissionAnchors(string CommandRoot, string Kind, string Scenario,
    string ScenarioNonce, string Descriptor, string Build, string? FaultScenario,
    IReadOnlyList<string> ExpectedPrefix, JsonElement History);

// One preparation's immutable selection and owned read handles, not an execution port.
internal sealed class WorkspaceSourceAdmission : IDisposable
{
    private readonly IReadOnlyList<SourceAdmissionFiles> files;
    private readonly object ioGate = new();
    internal SourceAdmissionAnchors Anchors { get; }
    internal string ProofSwitch { get; }
    internal string TokenEnvironment { get; }
    internal string RunRoot { get; }
    internal string MailboxRoot { get; }
    internal string WorkingDirectory { get; }
    internal string TemporaryRoot { get; }
    internal string ProofRoot { get; }
    internal string UserDataPath { get; }
    internal string SourceExecutable { get; }
    internal string ProjectionSha256 { get; }
    internal int PinCount => files.Sum(scope => scope.PinCount);
    internal bool AllHandlesClosed => files.All(scope => scope.AllHandlesClosed);

    private WorkspaceSourceAdmission(IReadOnlyList<SourceAdmissionFiles> files, SourceAdmissionAnchors anchors,
        string runRoot, SourceBootstrapProjection projection, string projectionSha256)
    {
        this.files = files;
        Anchors = anchors;
        ProofSwitch = projection.ProofSwitch;
        TokenEnvironment = projection.TokenEnvironment;
        RunRoot = runRoot;
        MailboxRoot = Path.Combine(anchors.CommandRoot, "scenario");
        WorkingDirectory = Path.Combine(runRoot, "scenario");
        TemporaryRoot = Path.Combine(WorkingDirectory, "p");
        (ProofRoot, UserDataPath) = projection.Derive(TemporaryRoot, anchors.ScenarioNonce);
        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? throw Invalid();
        if (!Path.IsPathFullyQualified(local)) throw Invalid();
        SourceExecutable = Path.Combine(local, "Programs", "Eky", "Eky.exe");
        ProjectionSha256 = projectionSha256;
    }

    internal static WorkspaceSourceAdmission Read(SourceAdmissionAnchors anchors, SourceAdmissionExperiment proof)
    {
        var scopes = new List<SourceAdmissionFiles>();
        WorkspaceSourceAdmission? result = null;
        proof.ReaderStarted.Set();
        try
        {
            proof.Stage = "parentPrefix";
            Require(anchors.Kind is "workspaceSuccess" or "workspaceFault");
            Require(anchors.Scenario == (anchors.Kind == "workspaceFault" ? "packagedWorkspaceFaultRollback" : "packagedWorkspaceSuccess"));
            var history = anchors.History.EnumerateArray().ToArray();
            Require(history.Length == anchors.ExpectedPrefix.Count);
            for (var index = 0; index < history.Length; index++)
            {
                var row = history[index];
                Require(row.GetProperty("phase").GetString() == anchors.ExpectedPrefix[index] &&
                    Hex(row.GetProperty("runNonce").GetString(), 64) && row.GetProperty("exitCode").GetInt32() == 0 &&
                    row.GetProperty("resultWritten").GetBoolean() && row.GetProperty("processBoundaryVerified").GetBoolean() &&
                    row.GetProperty("requestErrorCode").ValueKind == JsonValueKind.Null);
            }
            Require(Hex(anchors.ScenarioNonce, 64) && Hex(anchors.Descriptor, 64) && Hex(anchors.Build, 40));
            string PhaseNonce(string name) => history.Single(row => row.GetProperty("phase").GetString() == name)
                .GetProperty("runNonce").GetString()!;
            proof.Stage = "commandRoots";
            var files = SourceAdmissionFiles.OpenRoot(anchors.CommandRoot);
            scopes.Add(files);
            foreach (var phase in new[] { "prepare", "scenarioPreparation", "scenario" })
                files.PinChildDirectory(Path.Combine(anchors.CommandRoot, phase));
            proof.Stage = "prepareState";
            using var prepared = Parse(files.ReadPinnedJson(Path.Combine(anchors.CommandRoot, "prepare", "phase-state.json"), MaximumStateBytes));
            var originalState = State(prepared.RootElement, PhaseNonce("prepare"), anchors.Descriptor);
            proof.Stage = "scenarioPreparationState";
            using var current = Parse(files.ReadPinnedJson(Path.Combine(anchors.CommandRoot, "scenarioPreparation", "phase-state.json"), MaximumStateBytes));
            var state = State(current.RootElement, PhaseNonce("scenarioPreparation"), anchors.Descriptor);
            var runRoot = state.GetProperty("runRoot").GetString() ?? throw Invalid();
            Require(originalState.GetProperty("runRoot").GetString() == runRoot);
            proof.Stage = "runRootScope";
            var projection = SourceBootstrapProjection.Read(out var projectionHash);
            var temporaryParent = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
            Require(Path.IsPathFullyQualified(runRoot) && Same(Path.GetDirectoryName(runRoot), temporaryParent));
            var name = Path.GetFileName(runRoot);
            Require(name.StartsWith(projection.WorkspaceRunRootPrefix, StringComparison.Ordinal) &&
                name.Length == projection.WorkspaceRunRootPrefix.Length + 6 &&
                name[projection.WorkspaceRunRootPrefix.Length..].All(char.IsAsciiLetterOrDigit));
            var runFiles = SourceAdmissionFiles.OpenRoot(runRoot);
            scopes.Add(runFiles);
            runFiles.PinChildDirectory(Path.Combine(runRoot, "fixture"));
            runFiles.PinChildDirectory(Path.Combine(runRoot, "scenario"));
            proof.Stage = "artifactBinding";
            var artifact = state.GetProperty("artifact");
            Require(Same(artifact.GetProperty("artifactRoot").GetString(), Path.Combine(runRoot, "fixture")) &&
                artifact.GetProperty("descriptorSha256").GetString() == anchors.Descriptor &&
                artifact.GetProperty("buildRevision").GetString() == anchors.Build);
            proof.Stage = "workerBinding";
            using var worker = Parse(runFiles.ReadPinnedJson(Path.Combine(runRoot, "scenario", "worker-request.json"), MaximumWorkerBytes));
            var request = worker.RootElement;
            Exact(request, anchors.Kind == "workspaceFault"
                ? ["schemaVersion", "scenario", "runNonce", "artifactDescriptorSha256", "buildRevision", "fixtureRoot", "faultScenario"]
                : ["schemaVersion", "scenario", "runNonce", "artifactDescriptorSha256", "buildRevision", "fixtureRoot"]);
            Require(request.GetProperty("schemaVersion").GetInt32() == 1 &&
                request.GetProperty("scenario").GetString() == anchors.Scenario &&
                request.GetProperty("runNonce").GetString() == anchors.ScenarioNonce &&
                request.GetProperty("artifactDescriptorSha256").GetString() == anchors.Descriptor &&
                request.GetProperty("buildRevision").GetString() == anchors.Build &&
                Same(request.GetProperty("fixtureRoot").GetString(), Path.Combine(runRoot, "fixture")));
            if (anchors.Kind == "workspaceFault") Require(anchors.FaultScenario is not null &&
                projection.FaultScenarios.Contains(anchors.FaultScenario, StringComparer.Ordinal) &&
                request.GetProperty("faultScenario").GetString() == anchors.FaultScenario);
            proof.Stage = "bootstrapRoots";
            result = new(scopes, anchors, runRoot, projection, projectionHash);
            proof.Current = result;
            runFiles.PinChildDirectory(result.TemporaryRoot);
            runFiles.PinChildDirectory(Path.Combine(result.TemporaryRoot, projection.DirectoryName));
            runFiles.PinChildDirectory(result.ProofRoot);
            runFiles.PinChildDirectory(result.UserDataPath);
            proof.Stage = "admissionReadHeld";
            proof.HoldAdmissionRead();
            proof.Stage = "admissionFinalIdentity";
            result.Verify();
            proof.MetadataValidated = true;
            return result;
        }
        catch (Exception error)
        {
            proof.ObserveFirst(error);
            try { Close(scopes); }
            catch (Exception cleanup) { proof.ObserveCleanup(cleanup); }
            throw;
        }
        finally { proof.ReaderFinished.Set(); }
    }

    internal void Verify()
    {
        lock (ioGate)
        {
            for (var index = 0; index < files.Count; index++)
            {
                try { files[index].VerifyAll(); }
                catch (Exception error)
                {
                    try { error.Data["sourceAdmissionScopeOrdinal"] = index; }
                    catch { }
                    throw;
                }
            }
        }
    }
    public void Dispose() { lock (ioGate) Close(files); }
    private static void Close(IReadOnlyList<SourceAdmissionFiles> scopes)
    {
        Exception? first = null;
        for (var index = scopes.Count - 1; index >= 0; index--)
        {
            try { scopes[index].Dispose(); }
            catch (Exception error) { first ??= error; }
        }
        if (first is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(first).Throw();
    }
    // Same byte ceiling as the existing Node private-state reader; not a backup limit.
    private const int MaximumStateBytes = 16 * 1024 * 1024;
    private const int MaximumWorkerBytes = 128 * 1024;
    private static bool Same(string? left, string right) => string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    private static bool Hex(string? value, int length) => value is not null && value.Length == length &&
        value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static SupervisorFailure Invalid() => new("processStateInvalid");
    private static void Require(bool value) { if (!value) throw Invalid(); }
    private static JsonElement State(JsonElement root, string nonce, string descriptor)
    {
        Exact(root, ["binding", "state"]);
        var binding = root.GetProperty("binding");
        Exact(binding, ["schemaVersion", "runNonce", "scenario", "artifactDescriptorSha256"]);
        Require(binding.GetProperty("schemaVersion").GetInt32() == 1 && binding.GetProperty("runNonce").GetString() == nonce &&
            binding.GetProperty("scenario").GetString() == "acceptanceCommandPhase" &&
            binding.GetProperty("artifactDescriptorSha256").GetString() == descriptor);
        var state = root.GetProperty("state");
        Require(state.ValueKind == JsonValueKind.Object);
        return state;
    }
    private static void Exact(JsonElement value, IReadOnlyCollection<string> keys)
    {
        Require(value.ValueKind == JsonValueKind.Object);
        var names = value.EnumerateObject().Select(property => property.Name).ToArray();
        Require(names.Length == keys.Count && names.Distinct(StringComparer.Ordinal).Count() == names.Length &&
            names.All(name => keys.Contains(name, StringComparer.Ordinal)));
    }
    private static JsonDocument Parse(byte[] bytes)
    {
        var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 });
        try
        {
            var pending = new Stack<JsonElement>();
            pending.Push(document.RootElement);
            while (pending.TryPop(out var item))
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    var names = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var property in item.EnumerateObject())
                    { Require(names.Add(property.Name)); pending.Push(property.Value); }
                }
                else if (item.ValueKind == JsonValueKind.Array)
                    foreach (var child in item.EnumerateArray()) pending.Push(child);
            }
            return document;
        }
        catch { document.Dispose(); throw; }
    }
}

// Closed controls for this private command fixture, not a production observer API.
internal sealed class SourceAdmissionExperiment(string selectedCase)
{
    internal string Case { get; } = selectedCase;
    internal string? FixtureDirectory { get; set; }
    internal string Stage { get; set; } = "notStarted";
    internal WorkspaceSourceAdmission? Current { get; set; }
    internal bool MetadataValidated { get; set; }
    internal bool Published { get; set; }
    internal int Consumed { get; set; }
    internal int WorkerStarts;
    internal SupervisorOutcome? FinalOwnerOutcome { get; set; }
    internal object? ReservationProof { get; set; }
    internal Action<long>? SourceReservationCloseRequested { get; set; }
    internal bool LateAuthorityRejected { get; set; }
    internal bool ClosedDuringHeldRead { get; set; }
    internal bool MutationBlocked { get; set; }
    internal bool BoundedStopAfterScenario { get; set; }
    internal object? SourceProof { get; set; }
    internal string? RaceKind { get; set; }
    internal RetirementRaceContract? RetirementRace { get; set; }
    internal object? RaceProof { get; set; }
    internal ManualResetEventSlim TransportReadHeld { get; } = new();
    internal ManualResetEventSlim TransportReadRelease { get; } = new();
    internal ManualResetEventSlim SourceCreationHeld { get; } = new();
    internal ManualResetEventSlim SourceCreationRelease { get; } = new();
    internal object? FirstFailure { get; private set; }
    internal object? CleanupFailure { get; private set; }
    internal ManualResetEventSlim ReaderStarted { get; } = new();
    internal ManualResetEventSlim ReaderFinished { get; } = new();
    internal ManualResetEventSlim PreparationFinished { get; } = new();
    internal ManualResetEventSlim ReadHeld { get; } = new();
    internal ManualResetEventSlim ReadRelease { get; } = new();
    internal ManualResetEventSlim CreationHeld { get; } = new();
    internal ManualResetEventSlim CreationRelease { get; } = new();
    internal Task DeferredRelease { get; set; } = Task.CompletedTask;
    internal Action<SourceAdmissionAnchors>? BeforeAdmission { get; set; }
    internal Action<WorkspaceSourceAdmission>? BeforeCreation { get; set; }
    private readonly object failureGate = new();
    internal void HoldAdmissionRead()
    {
        if (Case != "preparationLate") return;
        ReadHeld.Set();
        ReadRelease.Wait();
    }
    internal void NotifySourceReservationCloseRequested(long elapsedMilliseconds)
    {
        try { SourceReservationCloseRequested?.Invoke(elapsedMilliseconds); }
        catch (Exception error)
        {
            // Observation failure must never replace the actual cancellation failure.
            try { ObserveCleanup(error); } catch { }
        }
    }
    internal void ObserveFirst(Exception error) { lock (failureGate) FirstFailure ??= Project(error, Stage); }
    internal void ObserveCleanup(Exception error) { lock (failureGate) CleanupFailure ??= Project(error, "admissionClose"); }
    private object Project(Exception error, string stage) => new
    {
        stage, exceptionType = error is SupervisorFailure ? "SupervisorFailure" :
            error is System.ComponentModel.Win32Exception ? "Win32Exception" :
            error is JsonException ? "JsonException" : error is IOException ? "IOException" : "other",
        errorCode = (error as SupervisorFailure)?.ErrorCode,
        nativeError = (error as System.ComponentModel.Win32Exception)?.NativeErrorCode ?? (error as SupervisorFailure)?.Win32ErrorCode,
        hresult = error.HResult,
        admissionState = new { MetadataValidated, Published, Consumed, workerStarts = Volatile.Read(ref WorkerStarts) },
        scopeOrdinal = error.Data["sourceAdmissionScopeOrdinal"],
        pinOrdinal = error.Data["sourceAdmissionPinOrdinal"],
        pinKind = error.Data["sourceAdmissionPinKind"],
        managedFrames = new System.Diagnostics.StackTrace(error, false).GetFrames().Take(12)
            .Select(frame => frame.GetMethod())
            .Select(method => new { owner = method?.DeclaringType?.FullName, method = method?.Name }).ToArray(),
        nativeObservation = error.Data.Contains("sourceAdmissionNativeOperation") ? new
        {
            scopeOrdinal = error.Data["sourceAdmissionScopeOrdinal"],
            pinOrdinal = error.Data["sourceAdmissionPinOrdinal"],
            pinKind = error.Data["sourceAdmissionPinKind"],
            operation = error.Data["sourceAdmissionNativeOperation"],
            handleKind = error.Data["sourceAdmissionHandleKind"],
            directory = error.Data["sourceAdmissionNativeDirectory"],
            nativeError = error.Data["sourceAdmissionNativeError"],
        } : null,
    };
}
