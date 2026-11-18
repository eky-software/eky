using System.Diagnostics;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

internal static class MsiObservationContract
{
    internal static int Run(string mode, string requestPath)
    {
        var request = SupervisorRequestReader.Read(["--request", requestPath]);
        if (mode == "msiObservationContracts") return RunContracts(request);
        return SupervisorProgram.Run(["--request", requestPath], (input, clock, evidence) =>
            new WindowsJobProcessSupervisor(clock, evidence, observeMsiActivity: _ =>
            {
                var root = Path.Combine(input.WorkingDirectory, input.RunNonce);
                Directory.CreateDirectory(root);
                var marker = Path.Combine(root, "observation.ready.json");
                File.WriteAllText(marker + ".next", JsonSerializer.Serialize(new
                {
                    schemaVersion = 1, input.RunNonce, role = "observation", processId = Environment.ProcessId,
                }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
                File.Move(marker + ".next", marker);
                if (mode == "msiObservationThrows") throw new IOException("synthetic private failure");
                // A deliberately unreturning optional read must not keep the real command alive.
                using var neverReturned = new ManualResetEvent(false);
                neverReturned.WaitOne();
                return WorkspaceMsiMembership.None;
            }).Run(input));
    }

    private static int RunContracts(SupervisorRequest request)
    {
        var checks = new Dictionary<string, bool>();
        void Check(string name, bool value)
        {
            checks.Add(name, value);
            if (!value) throw new InvalidOperationException("msiObservationContractFailed");
        }
        using var own = WindowsJob.Create();
        using var other = WindowsJob.Create();
        using var child = SuspendedWindowsProcess.Start(request, own, CancellationToken.None);
        using var outsider = SuspendedWindowsProcess.Start(request, other, CancellationToken.None);
        var childExitVerified = false;
        try
        {
            Check("ownedHandle", WorkspaceMsiActivityObservation.ObserveHandle(own, child.Process) == WorkspaceMsiMembership.Owned);
            Check("outsideHandle", WorkspaceMsiActivityObservation.ObserveHandle(own, outsider.Process) == WorkspaceMsiMembership.Outside);
            Check("otherJobPositiveControl", WorkspaceMsiActivityObservation.ObserveHandle(other, outsider.Process) == WorkspaceMsiMembership.Owned);
            using (var invalid = new SafeProcessHandle(IntPtr.Zero, false))
                Check("invalidUnknown", WorkspaceMsiActivityObservation.ObserveHandle(own, invalid) == WorkspaceMsiMembership.Unknown);
            var birth = MsiResourceObservation.ReadCreationIdentity(child.Process)
                ?? throw new InvalidOperationException("msiObservationContractFailed:sourceBirthUnavailable");
            var staleBirth = birth;
            staleBirth.Low ^= 1;
            using var wrongBirth = MsiResourceObservation.SourceRead.Retain(child, own, staleBirth);
            Check("sourceHandleRejectsWrongBirth", wrongBirth is null);
            using var wrongJob = MsiResourceObservation.SourceRead.Retain(child, other, birth);
            Check("sourceHandleRejectsWrongJob", wrongJob is null);
            using (var retained = MsiResourceObservation.SourceRead.Retain(child, own, birth)
                ?? throw new InvalidOperationException("msiObservationContractFailed:sourceReadUnavailable"))
            {
                Check("retainedSourceInitiallyLive", retained.IsLive() is true);
                Check("retainedSourceClassifiesExactBirth", retained.MembershipAtSample(own, birth) == "ownedJob" &&
                    retained.MembershipAtSample(own, staleBirth) == "unknown");
                Check("retainedSourceRejectsAnotherSampleJob", retained.MembershipAtSample(other, birth) == "unknown");
                child.CloseSourceObservationAdmission();
                using var lateRead = MsiResourceObservation.SourceRead.Retain(child, own, birth);
                Check("closedSourceObservationRejectsLateRead", lateRead is null && retained.IsLive() is true);
                child.Resume();
                childExitVerified = child.Wait(5000) && child.GetExitCode() == 0;
                Check("normalChildExit", childExitVerified);
                Check("exitedUnknown", WorkspaceMsiActivityObservation.ObserveHandle(own, child.Process) == WorkspaceMsiMembership.Unknown);
                child.Dispose();
                Check("sourceCloseNotSignalledWhileReadRetained", !child.HandlesClosed && retained.IsLive() is false);
                retained.Dispose();
                Check("sourceHandleClosedAfterReadRelease", child.HandlesClosed && retained.IsLive() is null);
            }
            Check("exitDuringReadUnknown", WorkspaceMsiActivityObservation.ObserveHandle(other, outsider.Process, () =>
            {
                other.Terminate();
                if (!outsider.Wait(5000)) throw new InvalidOperationException("childExitMissing");
            }) == WorkspaceMsiMembership.Unknown);
            foreach (var (a, b, c, expected) in new[]
            {
                (false, false, false, WorkspaceMsiMembership.None), (true, false, false, WorkspaceMsiMembership.Owned),
                (false, true, false, WorkspaceMsiMembership.Outside), (true, true, false, WorkspaceMsiMembership.Mixed),
                (true, true, true, WorkspaceMsiMembership.Unknown),
            }) Check("aggregate" + expected, WorkspaceMsiActivityObservation.Combine(a, b, c) == expected);

            var output = new StringWriter();
            var prior = Console.Out;
            Console.SetOut(output);
            var timer = Stopwatch.StartNew();
            var evidence = new SafeEvidenceWriter(request.Scenario, timer);
            Console.SetOut(prior);
            var expectedCodes = new[] { "noneObserved", "ownedObserved", "outsideObserved", "mixedObserved", "observationUnknown", "observationLimited" };
            var kinds = Enum.GetValues<WorkspaceMsiMembership>();
            foreach (var kind in kinds)
            {
                using var sample = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence, _ => kind);
                sample.Poll(0);
                Check("completed" + kind, sample.PendingRead!.Wait(5000));
                sample.Poll(1);
                Check("interval" + kind, sample.PendingRead is null);
            }
            using (var failed = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence,
                _ => throw new IOException("private diagnostic must not escape")))
            {
                failed.Poll(0);
                Check("failedReadFinished", SpinWait.SpinUntil(() => failed.PendingRead!.IsCompleted, 5000));
                failed.Dispose();
            }
            using (var disabled = new WorkspaceMsiActivityObservation("jobObjectFeasibility", own, evidence,
                _ => throw new InvalidOperationException("disabledObserverStarted")))
            {
                disabled.Poll(0);
                Check("unrelatedScenarioDisabled", disabled.PendingRead is null);
            }
            using var started = new ManualResetEventSlim(false);
            using var release = new ManualResetEventSlim(false);
            var calls = 0;
            using (var late = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence, _ =>
            {
                Interlocked.Increment(ref calls);
                started.Set();
                release.Wait();
                return WorkspaceMsiMembership.Owned;
            }))
            {
                try
                {
                    late.Poll(0);
                    Check("readStarted", started.Wait(5000));
                    var pending = late.PendingRead!;
                    late.Poll(60_000);
                    Check("singleInflight", calls == 1 && ReferenceEquals(pending, late.PendingRead));
                    late.Dispose();
                    late.Dispose();
                    Check("disposeDoesNotWait", !pending.IsCompleted);
                    release.Set();
                    Check("lateReadFinished", pending.Wait(5000));
                    late.Poll(120_000);
                    Check("stoppedDoesNotRestart", calls == 1);
                }
                finally { release.Set(); }
            }
            evidence.CompleteWithinRequestBudget(5000);
            var rows = output.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(line => JsonDocument.Parse(line)).ToArray();
            try
            {
                Check("closedCodeMapping", rows.Take(6).Select(row => row.RootElement.GetProperty("resultCode").GetString()).SequenceEqual(expectedCodes));
                Check("failureIsUnknown", rows[6].RootElement.GetProperty("resultCode").GetString() == "observationUnknown");
                Check("pendingOnceNoLatePublication", rows.Length == 8 && rows[7].RootElement.GetProperty("resultCode").GetString() == "observationPending");
                Check("noRawFailure", !output.ToString().Contains("private diagnostic", StringComparison.Ordinal));
            }
            finally { foreach (var row in rows) row.Dispose(); }

            // Exercise the lifetime cap with completed reads, without a wall-clock sleep.
            var cappedOutput = new StringWriter();
            Console.SetOut(cappedOutput);
            var cappedTimer = Stopwatch.StartNew();
            var cappedEvidence = new SafeEvidenceWriter(request.Scenario, cappedTimer);
            Console.SetOut(prior);
            var cappedCalls = 0;
            using (var capped = new WorkspaceMsiActivityObservation(request.Scenario, own, cappedEvidence, _ =>
            {
                Interlocked.Increment(ref cappedCalls);
                return WorkspaceMsiMembership.None;
            }))
            {
                for (var index = 0; index < WorkspaceMsiActivityObservation.MaximumSamples; index++)
                {
                    capped.Poll(index * 60_000L);
                    if (!capped.PendingRead!.Wait(5000)) throw new InvalidOperationException("sampleMissing");
                }
                capped.Poll(WorkspaceMsiActivityObservation.MaximumSamples * 60_000L);
                Check("lifetimeSampleCap", capped.PendingRead is null && cappedCalls == WorkspaceMsiActivityObservation.MaximumSamples);
            }
            var sourceResumed = false;
            var sourceSamples = 0;
            using (var scoped = new WorkspaceMsiActivityObservation(request.Scenario, own, cappedEvidence, _ =>
            {
                Interlocked.Increment(ref sourceSamples);
                return WorkspaceMsiMembership.None;
            }, sourceObservation: new(() => sourceResumed, () => null, () => 0)))
            {
                scoped.Poll(0);
                Check("sourceObservationInitialSample", scoped.PendingRead!.Wait(5000));
                scoped.Poll(1);
                Check("sourceObservationDoesNotRearmBeforeResume", scoped.PendingRead is null && sourceSamples == 1);
                sourceResumed = true;
                scoped.Poll(2);
                Check("sourceObservationRearmsOnceAtResume", scoped.PendingRead!.Wait(5000) && sourceSamples == 2);
                scoped.Poll(3);
                Check("sourceObservationDoesNotRearmAgain", scoped.PendingRead is null && sourceSamples == 2);
            }
            cappedEvidence.CompleteWithinRequestBudget(5000);

            // Characterize a short client lifetime between samples without wall-clock sleeps.
            foreach (var control in new[] { "transient", "persistent", "absent" })
            {
                var sampledOutput = new StringWriter();
                SafeEvidenceWriter sampledEvidence;
                try
                {
                    Console.SetOut(sampledOutput);
                    sampledEvidence = new SafeEvidenceWriter(request.Scenario, Stopwatch.StartNew());
                }
                finally { Console.SetOut(prior); }
                var available = 0;
                var observedCalls = 0;
                var prefix = "sampling-" + control + "-";
                using (var sampled = new WorkspaceMsiActivityObservation(request.Scenario, own, sampledEvidence, _ =>
                {
                    Interlocked.Increment(ref observedCalls);
                    return Volatile.Read(ref available) == 1 ? WorkspaceMsiMembership.Owned : WorkspaceMsiMembership.None;
                }))
                {
                    void CompleteSample(long elapsed)
                    {
                        sampled.Poll(elapsed);
                        var read = sampled.PendingRead ?? throw new InvalidOperationException("sampleMissing");
                        Check(prefix + "read-" + elapsed, read.Wait(5000));
                        sampled.Poll(elapsed + 1);
                    }
                    CompleteSample(14);
                    CompleteSample(60_117);
                    Volatile.Write(ref available, control == "absent" ? 0 : 1);
                    sampled.Poll(63_000);
                    Check(prefix + "betweenSamples", sampled.PendingRead is null && Volatile.Read(ref observedCalls) == 2);
                    Check(prefix + "controlledAvailability", Volatile.Read(ref available) == (control == "absent" ? 0 : 1));
                    if (control == "transient") Volatile.Write(ref available, 0);
                    sampled.Poll(64_000);
                    Check(prefix + "stillBetweenSamples", sampled.PendingRead is null && Volatile.Read(ref observedCalls) == 2);
                    CompleteSample(120_118);
                    Check(prefix + "threeReads", Volatile.Read(ref observedCalls) == 3);
                }
                sampledEvidence.CompleteWithinRequestBudget(5000);
                var codes = sampledOutput.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(line =>
                    {
                        using var row = JsonDocument.Parse(line);
                        return row.RootElement.GetProperty("resultCode").GetString();
                    }).ToArray();
                Check(prefix + "lateSequence", codes.SequenceEqual(new[]
                {
                    "noneObserved", "noneObserved", control == "persistent" ? "ownedObserved" : "noneObserved",
                }));
            }
        }
        finally
        {
            own.Terminate(); other.Terminate();
            Check("childrenExited", (childExitVerified && child.HandlesClosed || child.Wait(5000)) && outsider.Wait(5000));
            Check("ownedTreesAbsent", own.GetActiveProcessCount() == 0 && other.GetActiveProcessCount() == 0);
        }
        using var file = new FileStream(Path.Combine(request.WorkingDirectory, "msi-observation-contract.json"), FileMode.CreateNew);
        JsonSerializer.Serialize(file, checks);
        return 0;
    }
}
