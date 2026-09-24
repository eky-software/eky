using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

internal static class DeadlineReadinessContract
{
    internal static readonly HashSet<string> Modes =
    [
        "deadlineRootBeforeGrandchild", "deadlineBothLive", "deadlineSetupNeverReady",
        "deadlineCreationFailure", "deadlineCreationPending", "deadlineProofWriteFailure",
        "deadlineResultWriteFailure",
    ];
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    internal static int Run(string mode, string requestPath)
    {
        var wallClock = Stopwatch.StartNew();
        SafeProcessHandle? root = null;
        SafeProcessHandle? grandchild = null;
        SafeProcessHandle? sentinel = null;
        SafeEvidenceWriter? evidence = null;
        try
        {
            var request = SupervisorRequestReader.Read(["--request", requestPath]);
            if (request.TimeoutMilliseconds != 2_500 || request.CleanupReserveMilliseconds != 800)
                return 64;
            var runRoot = Path.Combine(request.WorkingDirectory, request.RunNonce);
            var beforeGrandchild = mode == "deadlineRootBeforeGrandchild";
            var proof = new DeadlineProof
            {
                RunNonce = request.RunNonce,
                Scenario = request.Scenario,
                ArtifactDescriptorSha256 = request.ArtifactDescriptorSha256,
                Contract = beforeGrandchild ? "rootBeforeGrandchild" : "bothLive",
            };
            var clock = new ControlledSupervisorDeadline(request.TimeoutMilliseconds - request.CleanupReserveMilliseconds);
            evidence = new SafeEvidenceWriter(request.Scenario, wallClock);
            WindowsJob? observedJob = null;
            var observed = false;
            var supervisor = new WindowsJobProcessSupervisor(wallClock, evidence,
                (input, job, cancellation) =>
                {
                    observedJob = job;
                    if (mode == "deadlineCreationFailure") throw new SupervisorFailure("processStartFailed", 2);
                    if (mode == "deadlineCreationPending")
                    {
                        using var pending = new ManualResetEvent(false);
                        pending.WaitOne();
                    }
                    return SuspendedWindowsProcess.Start(input, job, cancellation);
                },
                child =>
                {
                    if (observed) return child.Wait(0);
                    observed = true;
                    try
                    {
                        var job = observedJob!;
                        root = Pin(child.Process);
                        var rootId = GetProcessId(root);
                        Require(rootId != 0, "processIdentityInvalid");
                        var rootMarker = WaitForJson(Path.Combine(runRoot, "root.ready.json"), clock, root);
                        RequireMarker(rootMarker, request, "root", rootId);
                        proof.Root.Ready = true;
                        var gate = WaitForJson(Path.Combine(runRoot, "grandchild.gate.json"), clock, root);
                        RequireKeys(gate, "schemaVersion", "runNonce", "rootProcessId");
                        Require(gate.GetProperty("schemaVersion").GetInt32() == 1 &&
                            gate.GetProperty("runNonce").GetString() == request.RunNonce &&
                            gate.GetProperty("rootProcessId").GetUInt32() == rootId, "gateInvalid");
                        proof.Root.Member = job.ContainsProcess(root);
                        proof.Root.AliveBeforeDeadline = IsAlive(root);
                        Require(proof.Root.Member && proof.Root.AliveBeforeDeadline, "rootNotLiveMember");
                        Require(!File.Exists(Path.Combine(runRoot, "grandchild-create.release")), "gateInvalid");

                        var sentinelMarker = ReadJson(Path.Combine(runRoot, "sentinel.ready.json"));
                        var sentinelId = RequireMarker(sentinelMarker, request, "sentinel");
                        sentinel = OpenPinned(sentinelId);
                        proof.Sentinel.OutsideJob = !job.ContainsProcess(sentinel);
                        proof.Sentinel.AliveBeforeDeadline = IsAlive(sentinel);
                        Require(proof.Sentinel.OutsideJob && proof.Sentinel.AliveBeforeDeadline, "sentinelNotForeignLive");

                        if (beforeGrandchild)
                        {
                            Require(!File.Exists(Path.Combine(runRoot, "grandchild.ready.json")) &&
                                job.GetActiveProcessCount() == 1, "gateInvalid");
                            proof.CreationWithheld = true;
                        }
                        else
                        {
                            using (File.Open(Path.Combine(runRoot, "grandchild-create.release"),
                                FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { }
                            var marker = WaitForJson(Path.Combine(runRoot, "grandchild.ready.json"), clock, root);
                            var grandchildId = RequireMarker(marker, request, "grandchild");
                            Require(grandchildId != rootId && grandchildId != sentinelId, "processIdentityInvalid");
                            grandchild = OpenPinned(grandchildId);
                            proof.Grandchild.Ready = true;
                            proof.Grandchild.Member = job.ContainsProcess(grandchild);
                            proof.Grandchild.AliveBeforeDeadline = IsAlive(grandchild);
                            Require(proof.Grandchild.Member && proof.Grandchild.AliveBeforeDeadline &&
                                CreationTime(grandchild) >= CreationTime(root) &&
                                job.GetActiveProcessCount() == 2, "grandchildNotLiveMember");
                        }
                        Require(IsAlive(root) && IsAlive(sentinel) &&
                            (grandchild is null || IsAlive(grandchild)), "processExitedBeforeDeadline");
                        proof.DeadlineTriggered = clock.TryTriggerDeadline();
                    }
                    catch (ContractFailure failure) { clock.RejectSetup(failure.Code); }
                    catch { clock.RejectSetup("readinessFailed"); }
                    return child.Wait(0);
                }, deadline: clock);

            // Exercise the real core and writer, not a fabricated CLI completion.
            var outcome = supervisor.Run(request);
            proof.SetupFailure = clock.SetupFailureCode;
            var injectResultWriteFailure = mode == "deadlineResultWriteFailure";
            var expectedPublishFailure = false;
            if (injectResultWriteFailure) Directory.CreateDirectory(request.ResultPath);
            try { SupervisorResultWriter.Write(request, outcome, wallClock.ElapsedMilliseconds); }
            catch (SupervisorResultWriteFailure failure) when (injectResultWriteFailure &&
                failure.Phase == SupervisorResultWritePhase.Publish &&
                failure.LastCompletedPhase == SupervisorResultWritePhase.Close)
            {
                expectedPublishFailure = true;
            }
            Require(!injectResultWriteFailure || expectedPublishFailure, "resultWriteFailureNotObserved");
            try
            {
                proof.Root.ExitedAfterCleanup = root is not null && !IsAlive(root);
                proof.Grandchild.ExitedAfterCleanup = grandchild is not null && !IsAlive(grandchild);
                proof.Sentinel.AliveAfterCleanup = sentinel is not null && IsAlive(sentinel);
            }
            catch { proof.SetupFailure ??= "exitProofFailed"; }
            var proofPath = Path.Combine(request.WorkingDirectory, "deadline-process-proof.json");
            if (mode == "deadlineProofWriteFailure") Directory.CreateDirectory(proofPath);
            try { WriteJson(proofPath, proof); }
            catch (ProofPublicationFailure) when (mode == "deadlineProofWriteFailure")
            {
                WriteJson(Path.Combine(request.WorkingDirectory, "deadline-proof-write-failure.json"), new
                {
                    schemaVersion = 1,
                    runNonce = request.RunNonce,
                    scenario = request.Scenario,
                    artifactDescriptorSha256 = request.ArtifactDescriptorSha256,
                    resultCode = "proofWriteFailed",
                    writePhase = "publish",
                });
                return 1;
            }
            if (expectedPublishFailure)
            {
                // This companion records the real writer failure; it is not a CLI terminal.
                WriteJson(Path.Combine(request.WorkingDirectory, "deadline-writer-proof.json"), new
                {
                    schemaVersion = 1,
                    runNonce = request.RunNonce,
                    scenario = request.Scenario,
                    artifactDescriptorSha256 = request.ArtifactDescriptorSha256,
                    resultCode = "resultWriteFailed",
                    writePhase = "publish",
                    lastCompletedPhase = "close",
                    processResultCode = outcome.ProcessResultCode,
                    cleanupResultCode = outcome.CleanupResultCode,
                    processTreeAbsent = outcome.ProcessTreeAbsent,
                });
                return 1;
            }
            return outcome.Status == "completed" ? 0 : 1;
        }
        catch { return 1; }
        finally
        {
            root?.Dispose();
            grandchild?.Dispose();
            sentinel?.Dispose();
            evidence?.CompleteWithinRequestBudget(0);
        }
    }

    internal static int RunClockContracts(string requestPath)
    {
        try
        {
            var request = SupervisorRequestReader.Read(["--request", requestPath]);
            var watch = Stopwatch.StartNew();
            var real = new StopwatchSupervisorDeadline(watch);
            var before = watch.ElapsedMilliseconds;
            real.OnCleanupStarting();
            Require(watch.IsRunning && real.ElapsedMilliseconds >= before &&
                real.ElapsedMilliseconds <= watch.ElapsedMilliseconds, "defaultClockInvalid");
            Require(real.WaitForTask(Task.CompletedTask, 0), "completedTaskInvalid");
            var cancelled = Task.FromCanceled(new CancellationToken(true));
            Require(real.WaitForTask(cancelled, 0), "completedTaskInvalid");
            var faulted = Task.FromException(new InvalidOperationException());
            Require(real.WaitForTask(faulted, 0), "completedTaskInvalid");
            _ = faulted.Exception;
            var never = new TaskCompletionSource();
            Require(!real.WaitForTask(never.Task, 0), "expiredWaitInvalid");

            var controlled = new ControlledSupervisorDeadline(1_700);
            var completed = new TaskCompletionSource();
            // Deliberately cross a real wait slice, not a readiness/success sleep.
            using (var timer = new Timer(_ => completed.SetResult(), null, 150, Timeout.Infinite))
                Require(controlled.WaitForTask(completed.Task, 1), "frozenWaitInvalid");
            Require(controlled.ElapsedMilliseconds == 0 && controlled.TryTriggerDeadline(), "triggerInvalid");
            var progressionGuard = Stopwatch.StartNew();
            var advanced = controlled.ElapsedMilliseconds;
            for (var duplicate = 0; duplicate < 2; duplicate++)
            {
                advanced = WaitForClockProgress(controlled, advanced, progressionGuard);
                controlled.OnCleanupStarting();
                var afterCleanup = controlled.ElapsedMilliseconds;
                Require(afterCleanup >= advanced, "cleanupResetInvalid");
                advanced = afterCleanup;
            }
            Require(!controlled.TryTriggerDeadline(), "cleanupResetInvalid");
            var early = new ControlledSupervisorDeadline(1_700);
            early.OnCleanupStarting();
            Require(early.SetupFailureCode is not null && early.ElapsedMilliseconds >= 1_700, "earlyCleanupInvalid");
            var rejected = new ControlledSupervisorDeadline(1_700);
            rejected.RejectSetup("firstFailure");
            rejected.RejectSetup("secondFailure");
            Require(rejected.SetupFailureCode == "firstFailure" && !rejected.TryTriggerDeadline(), "failureReplaced");
            WriteJson(Path.Combine(request.WorkingDirectory, "deadline-clock-proof.json"), new
            {
                schemaVersion = 1, defaultClockPreserved = true, actualTaskCompletion = true,
                frozenWaitPreserved = true, cleanupCannotReset = true, firstFailurePreserved = true,
            });
            return 0;
        }
        catch { return 1; }
    }

    private static long WaitForClockProgress(ControlledSupervisorDeadline clock, long previous, Stopwatch guard)
    {
        var observedAt = guard.ElapsedMilliseconds;
        using var tick = new ManualResetEvent(false);
        while (true)
        {
            var remaining = ControlledSupervisorDeadline.SetupTimeoutMilliseconds - guard.ElapsedMilliseconds;
            Require(remaining > 0, "clockProgressExpired");
            var elapsed = clock.ElapsedMilliseconds;
            Require(elapsed >= previous, "cleanupResetInvalid");
            if (elapsed > previous && guard.ElapsedMilliseconds > observedAt) return elapsed;
            tick.WaitOne((int)Math.Min(ControlledSupervisorDeadline.WaitSliceMilliseconds, remaining));
        }
    }

    private static JsonElement WaitForJson(string path, ControlledSupervisorDeadline clock, SafeProcessHandle root)
    {
        using var tick = new ManualResetEvent(false);
        while (clock.ElapsedMilliseconds == 0)
        {
            Require(IsAlive(root), "processExitedBeforeDeadline");
            try { return ReadJson(path); }
            catch (FileNotFoundException) { }
            tick.WaitOne(ControlledSupervisorDeadline.WaitSliceMilliseconds);
        }
        throw new ContractFailure("readinessExpired");
    }

    private static JsonElement ReadJson(string path)
    {
        using var stream = File.OpenRead(path);
        Require(stream.Length is > 0 and <= 4_096, "markerInvalid");
        using var document = JsonDocument.Parse(stream);
        return document.RootElement.Clone();
    }

    private static uint RequireMarker(JsonElement marker, SupervisorRequest request, string role, uint? expectedId = null)
    {
        RequireKeys(marker, "schemaVersion", "runNonce", "role", "processId");
        var processId = marker.GetProperty("processId").GetUInt32();
        Require(marker.GetProperty("schemaVersion").GetInt32() == 1 &&
            marker.GetProperty("runNonce").GetString() == request.RunNonce &&
            marker.GetProperty("role").GetString() == role && processId > 0 &&
            (expectedId is null || processId == expectedId), "markerInvalid");
        return processId;
    }

    private static void RequireKeys(JsonElement value, params string[] keys) =>
        Require(value.ValueKind == JsonValueKind.Object &&
            value.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(keys.Order()), "markerInvalid");

    private static SafeProcessHandle Pin(SafeProcessHandle process)
    {
        Require(DuplicateHandle(new IntPtr(-1), process, new IntPtr(-1), out var pinned, 0, false, 2), "handlePinFailed");
        return pinned;
    }

    private static SafeProcessHandle OpenPinned(uint processId)
    {
        var handle = OpenProcess(0x00100000 | 0x1000, false, processId);
        if (!handle.IsInvalid) return handle;
        handle.Dispose();
        throw new ContractFailure("handlePinFailed");
    }

    private static bool IsAlive(SafeProcessHandle process) => NativeMethods.WaitForSingleObject(process, 0) switch
    {
        NativeMethods.WaitTimeout => true,
        NativeMethods.WaitObject0 => false,
        _ => throw new ContractFailure("handleWaitFailed"),
    };

    private static long CreationTime(SafeProcessHandle process)
    {
        Require(GetProcessTimes(process, out var creation, out _, out _, out _), "processIdentityInvalid");
        return creation;
    }

    private static void WriteJson<T>(string path, T value)
    {
        var temporary = path + ".next";
        using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            JsonSerializer.Serialize(stream, value, JsonOptions);
        try { File.Move(temporary, path, false); }
        catch (IOException) { throw new ProofPublicationFailure(); }
    }

    private static void Require(bool condition, string code)
    {
        if (!condition) throw new ContractFailure(code);
    }

    private sealed class ContractFailure(string code) : Exception { internal string Code => code; }
    private sealed class ProofPublicationFailure : Exception { }
    private sealed class MemberProof
    {
        public bool Ready { get; set; }
        public bool Member { get; set; }
        public bool AliveBeforeDeadline { get; set; }
        public bool ExitedAfterCleanup { get; set; }
    }
    private sealed class SentinelProof
    {
        public bool OutsideJob { get; set; }
        public bool AliveBeforeDeadline { get; set; }
        public bool AliveAfterCleanup { get; set; }
    }
    private sealed class DeadlineProof
    {
        public int SchemaVersion => 1;
        public string ClockKind => "controlled";
        public required string RunNonce { get; init; }
        public required string Scenario { get; init; }
        public required string ArtifactDescriptorSha256 { get; init; }
        public required string Contract { get; init; }
        public MemberProof Root { get; } = new();
        public MemberProof Grandchild { get; } = new();
        public SentinelProof Sentinel { get; } = new();
        public bool CreationWithheld { get; set; }
        public bool DeadlineTriggered { get; set; }
        public string? SetupFailure { get; set; }
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, SafeProcessHandle source,
        IntPtr targetProcess, out SafeProcessHandle target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(SafeProcessHandle process, out long creation, out long exit, out long kernel, out long user);
}
