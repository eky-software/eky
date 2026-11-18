using System.Diagnostics;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

internal static class MsiResourceContract
{
    internal static int Child(string inputPath)
    {
        if (!OperatingSystem.IsWindows()) return 63;
        using var input = JsonDocument.Parse(File.ReadAllText(inputPath));
        using var ready = EventWaitHandle.OpenExisting(input.RootElement.GetProperty("ready").GetString()!);
        using var stop = EventWaitHandle.OpenExisting(input.RootElement.GetProperty("stop").GetString()!);
        using var file = new FileStream(input.RootElement.GetProperty("file").GetString()!, FileMode.Open, FileAccess.Read, FileShare.Read);
        ready.Set();
        return stop.WaitOne(110_000) ? 0 : 64;
    }

    internal static int Run(string requestPath)
    {
        if (!OperatingSystem.IsWindows()) return 63;
        var request = SupervisorRequestReader.Read(["--request", requestPath]);
        var checks = new Dictionary<string, bool>();
        var timingEnabled = Environment.GetEnvironmentVariable("EKY_MSI_RESOURCE_TIMING_PROOF") == "1";
        const int releaseDelayMs = 150;
        const int resourceCount = 2550;
        const int childExitTimeoutMs = 5000;
        var timingArms = new List<object>();
        string[] bulk = [];
        ExceptionDispatchInfo? firstFailure = null;
        var payload = Path.Combine(request.WorkingDirectory, "payload");
        Directory.CreateDirectory(payload);
        var names = new[] { "owned.bin", "other.bin", "unused.bin", "same-job.bin" };
        foreach (var name in names) File.WriteAllBytes(Path.Combine(payload, name), "SYNTHETIC RM RESOURCE"u8.ToArray());
        var selectionPath = Path.Combine(request.WorkingDirectory, MsiWindowObservation.Contract.ResourceSelectionFilename);
        var children = new List<(SuspendedWindowsProcess Process, EventWaitHandle Stop)>();
        using var own = WindowsJob.Create();
        using var other = WindowsJob.Create();
        MsiResourceSample? observed = null;
        try
        {
            var published = MsiResourceSelection.Read(request, () => true, payload);
            Check("nodePublishedSelectionAdmitted", published is { Files.Length: 1 } && published.Files[0] == Path.Combine(payload, names[2]));
            File.Delete(selectionPath);
            Check("missingSelectionUnavailable", MsiResourceSelection.Read(request, () => true, payload) is null);
            WriteSelection(names);
            Check("validSelectionAdmitted", MsiResourceSelection.Read(request, () => true, payload)?.Files.Length == names.Length);
            Check("cancelledSelectionRejected", MsiResourceSelection.Read(request, () => false, payload) is null);
            foreach (var invalid in new[] { new[] { "../escape.bin" }, new[] { "owned.bin", "OWNED.bin" },
                new[] { "missing.bin" }, new[] { "owned.bin/child" }, new[] { "/owned.bin" }, new[] { "owned.bin " } })
            {
                WriteSelection(invalid);
                Check("invalidSelection" + checks.Count, MsiResourceSelection.Read(request, () => true, payload) is null);
            }
            WriteSelection(names, nonce: new string('e', 64));
            Check("staleNonceRejected", MsiResourceSelection.Read(request, () => true, payload) is null);
            WriteSelection(names, root: Path.GetDirectoryName(payload));
            Check("wrongRootRejected", MsiResourceSelection.Read(request, () => true, payload) is null);
            var junction = Path.Combine(payload, "junction", "foreign.bin");
            if (File.Exists(junction))
            {
                WriteSelection(["junction/foreign.bin"]);
                Check("junctionRejected", MsiResourceSelection.Read(request, () => true, payload) is null);
            }
            var a = Start(own, names[0]);
            var b = Start(other, names[1]);
            var aIdentity = Identity(a.Process);
            var bIdentity = Identity(b.Process);
            var staleBirth = new MsiResourceObservation.UniqueProcess { Pid = aIdentity.Pid,
                Low = aIdentity.Low ^ 1, High = aIdentity.High };
            WriteSelection([names[0]]);
            var registered = CaptureForSource(a.Process, aIdentity);
            observed = registered.Sample;
            Check("registeredHolderObserved", observed.Status == "observed" && observed.Processes.Any(row =>
                row.ProcessId == aIdentity.Pid && row.StartTimeLow == aIdentity.Low && row.StartTimeHigh == aIdentity.High && row.Membership == "ownedJob"));
            Check("unregisteredHolderExcluded", observed.Processes.All(row => row.ProcessId != bIdentity.Pid));
            Check("sessionClosed", observed.NativeCode == 0 && observed.EndSessionCode == 0);
            Check("queryBracketsAStableSource", registered.LiveBefore is true && registered.LiveAfter is true &&
                SourceRelation(registered, aIdentity) == "sourceReported");
            Check("samePidWrongCreationNotAttributed", SourceRelation(registered, staleBirth) == "unknown");
            Check("missingFinalLiveEvidenceNotAttributed", SourceRelation(registered with { LiveAfter = false },
                aIdentity) == "unknown");
            Check("incompleteSampleNotAttributed", SourceRelation(registered with {
                Sample = observed with { Status = "limited" } }, aIdentity) == "unknown");
            var sameJob = Start(own, names[3]);
            var sameJobIdentity = Identity(sameJob.Process);
            WriteSelection([names[3]]);
            var sibling = CaptureForSource(a.Process, aIdentity);
            Check("sameJobIsNotSourceIdentity", HasOwnedHolder(sibling.Sample, sameJobIdentity) &&
                SourceRelation(sibling, aIdentity) == "otherReported");
            WriteSelection([names[0], names[3]]);
            var mixed = CaptureForSource(a.Process, aIdentity);
            Check("mixedHoldersNotAttributedSolelyToSource", HasOwnedHolder(mixed.Sample, sameJobIdentity) &&
                SourceRelation(mixed, aIdentity) == "mixedReported");
            WriteSelection([names[1]]);
            var outside = CaptureForSource(a.Process, aIdentity);
            var external = outside.Sample;
            Check("outsideJobObserved", external.Status == "observed" && external.Processes.Any(row =>
                row.ProcessId == bIdentity.Pid && row.Membership == "outsideJob"));
            Check("outsideJobHolderNotAttributedToSource", SourceRelation(outside, aIdentity) == "otherReported");
            WriteSelection([names[2]]);
            var absent = CaptureForSource(a.Process, aIdentity);
            var empty = absent.Sample;
            Check("emptyObservedDistinct", empty.Status == "observed" && empty.Processes.Count == 0 && empty.EndSessionCode == 0);
            Check("emptyDoesNotExcludePriorSource", SourceRelation(absent, aIdentity) == "unknown");
            WriteSelection([names[3]]);
            var overlap = CaptureForSource(sameJob.Process, sameJobIdentity, () =>
            {
                Check("sameJobHolderReleased", sameJob.Stop.Set());
                Check("sameJobHolderExited", sameJob.Process.Wait(childExitTimeoutMs) && sameJob.Process.GetExitCode() == 0);
            });
            Check("sourceExitOverlapNotAttributed", overlap.LiveBefore is true && overlap.LiveAfter is false &&
                overlap.Sample.Status == "observed" && overlap.Sample.Processes.Any(row => Matches(row, sameJobIdentity)) &&
                SourceRelation(overlap, sameJobIdentity) == "unknown");
            Check("staleCreationUnknown", MsiResourceObservation.Membership(new() { Pid = aIdentity.Pid,
                Low = aIdentity.Low ^ 1, High = aIdentity.High }, own) == "unknown");
            var callbackReached = false;
            var exited = false;
            var membership = MsiResourceObservation.Membership(aIdentity, own, () =>
            { callbackReached = true; a.Stop.Set(); exited = a.Process.Wait(5000) && a.Process.GetExitCode() == 0; });
            Check("exitDuringReadVerified", callbackReached && exited && membership == "unknown");
            Check("exitedUnknown", MsiResourceObservation.Membership(aIdentity, own) == "unknown");
            WriteSelection([names[0]]);
            var afterExit = MsiResourceObservation.Capture(request, own, () => true, payload);
            Check("sameSelectionAfterVerifiedExitEmpty", afterExit is { Status: "observed", Phase: "complete",
                ResourceCount: 1, NativeCode: 0, EndSessionCode: 0 } &&
                afterExit.SelectionIdentity == observed.SelectionIdentity && afterExit.Processes.Count == 0);
            Check("moreDataLimited", MsiResourceObservation.QueryStatus(234, 33, 32, 32) == "limited");
            Check("badCountLimited", MsiResourceObservation.QueryStatus(0, 0, 33, 32) == "limited");
            Check("nativeFailureUnavailable", MsiResourceObservation.QueryStatus(121, 0, 0, 32) == "unavailable");
            Check("cancelledCaptureDistinct", MsiResourceObservation.Capture(request, own, () => false, payload).Status == "cancelled");

            var prompt = new[] { new MsiWindowSample(1, "observed", [new("message",
                "The following applications should be closed before continuing the installation:", true)]) };
            Check("ordinaryWindowDoesNotQuery", WorkspaceMsiActivityObservation.CaptureResources(request, own, [], () => true,
                (_, _, _) => throw new InvalidOperationException("unexpectedQuery")) is null);
            Check("stoppedDoesNotQuery", WorkspaceMsiActivityObservation.CaptureResources(request, own, prompt, () => false,
                (_, _, _) => throw new InvalidOperationException("unexpectedQuery")) is null);
            Check("promptUsesResourceReader", ReferenceEquals(observed,
                WorkspaceMsiActivityObservation.CaptureResources(request, own, prompt, () => true, (_, _, _) => observed)));
            Check("resourceFailureContained", WorkspaceMsiActivityObservation.CaptureResources(request, own, prompt, () => true,
                (_, _, _) => throw new IOException("EXCLUDED RAW FAILURE"))?.Status == "unavailable");

            using var started = new ManualResetEventSlim(false);
            using var release = new ManualResetEventSlim(false);
            var prior = Console.Out;
            var output = new StringWriter();
            Console.SetOut(output);
            var evidence = new SafeEvidenceWriter(request.Scenario, Stopwatch.StartNew());
            Console.SetOut(prior);
            using (var budget = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence))
            {
                long elapsed = 0;
                var admitted = budget.ResourceAdmission(() => elapsed);
                Check("textBudgetUnchanged", MsiWindowObservation.Contract.SampleTimeoutMilliseconds == 1000);
                Check("messageBudgetUnchanged", MsiWindowObservation.Contract.MessageTimeoutMilliseconds == 100);
                Check("resourceBudgetNamed", MsiWindowObservation.Contract.ResourceTimeoutMilliseconds == 10000);
                elapsed = MsiWindowObservation.Contract.SampleTimeoutMilliseconds;
                Check("textExpiryLeavesResourceTime", admitted());
                elapsed = 9999;
                Check("resourceAdmittedBeforeBoundary", admitted());
                elapsed = 10000;
                Check("resourceRejectedAtBoundary", !admitted());
                elapsed = 10001;
                Check("resourceRejectedAfterBoundary", !admitted());
                elapsed = 0;
                budget.Dispose();
                Check("stopOverridesRemainingResourceTime", !admitted());
            }
            using (var budget = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence))
            {
                long elapsed = 0;
                WriteSelection([names[1], names[2]]);
                var positive = MsiResourceObservation.Capture(request, own, budget.ResourceAdmission(() => elapsed), payload);
                Check("postQueryFailureHasLivePositiveControl", positive.Status == "observed" && positive.Processes.Any(row =>
                    row.ProcessId == bIdentity.Pid && row.StartTimeLow == bIdentity.Low && row.StartTimeHigh == bIdentity.High));
                var expired = MsiResourceObservation.Capture(request, own, budget.ResourceAdmission(() => elapsed),
                    payload, () => elapsed = MsiWindowObservation.Contract.ResourceTimeoutMilliseconds);
                Check("postQueryExpiryDropsIdentities", expired.Status == "limited" && expired.Phase == "selection" &&
                    expired.Processes.Count == 0 && expired.NativeCode == 0 && expired.EndSessionCode == 0);
                var changedFile = Path.Combine(payload, names[2]);
                var preservedFile = changedFile + ".preserved";
                MsiResourceSample changed;
                try
                {
                    changed = MsiResourceObservation.Capture(request, own, () => true, payload, () =>
                    {
                        File.Move(changedFile, preservedFile);
                        Directory.CreateDirectory(changedFile);
                    });
                }
                finally
                {
                    if (File.Exists(preservedFile))
                    {
                        Directory.Delete(changedFile);
                        File.Move(preservedFile, changedFile);
                    }
                }
                Check("postQuerySelectionChangeDropsIdentities", changed.Status == "limited" && changed.Phase == "selection" &&
                    changed.Processes.Count == 0 && changed.EndSessionCode == 0);
            }
            using (var observation = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence, _ =>
            {
                WorkspaceMsiActivityObservation.CaptureResources(request, own, prompt, () => true, (_, _, _) =>
                { started.Set(); release.Wait(); return observed; });
                return WorkspaceMsiMembership.Owned;
            }))
            {
                try
                {
                    observation.Poll(0);
                    Check("slowResourceReadStarted", started.Wait(5000));
                    var pending = observation.PendingRead!;
                    observation.Dispose();
                    Check("cleanupDoesNotAwaitResourceRead", !pending.IsCompleted);
                    release.Set();
                    Check("startedReadSettled", pending.Wait(5000));
                }
                finally { release.Set(); }
            }
            evidence.CompleteWithinRequestBudget(5000);
            Check("noRawPublicOutput", !output.ToString().Contains("EXCLUDED", StringComparison.Ordinal));
            bulk = Enumerable.Range(0, resourceCount).Select(index => $"bulk/file{index:D4}.bin").ToArray();
            Directory.CreateDirectory(Path.Combine(payload, "bulk"));
            foreach (var name in bulk) File.WriteAllBytes(Path.Combine(payload, name), "SYNTHETIC RM RESOURCE"u8.ToArray());
            var holder = Start(own, bulk[0]);
            var holderIdentity = Identity(holder.Process);
            WriteSelection(bulk);
            using (var budget = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence))
            {
                var clock = Stopwatch.StartNew();
                observed = WorkspaceMsiActivityObservation.CaptureResources(request, own, prompt,
                    budget.ResourceAdmission(() => clock.ElapsedMilliseconds),
                    (input, job, admitted) => MsiResourceObservation.Capture(input, job, admitted, payload));
            }
            Check("largeFreshSelectionObserved", observed is { Status: "observed", Phase: "complete", ResourceCount: 2550,
                NativeCode: 0, EndSessionCode: 0 } && observed.Processes.Any(row => row.ProcessId == holderIdentity.Pid &&
                row.StartTimeLow == holderIdentity.Low && row.StartTimeHigh == holderIdentity.High && row.Membership == "ownedJob"));
            var windowEvidence = new MsiWindowEvidence(request);
            Check("resourceEvidenceRecorded", windowEvidence.Publish(prompt, 0, () => false, observed) == "recorded");
            // The format control uses just the independently proved fixture holder.
            var measured = observed ?? throw new InvalidOperationException("msiResourceContractFailed:sourceEvidenceMissingSample");
            var sourceFormatSample = measured with { Processes = measured.Processes.Where(row => Matches(row, holderIdentity)).ToArray() };
            Check("sourcePromptStateDoesNotDependOnResources",
                MsiSourceObservation.ClassifyPromptState(true, true) == "alive" &&
                MsiSourceObservation.ClassifyPromptState(false, false) == "exitedBefore" &&
                MsiSourceObservation.ClassifyPromptState(true, false) == "unknown" &&
                MsiSourceObservation.ClassifyPromptState(null, false) == "unknown");
            var expectedSource = new MsiResourceObservation.UniqueProcess { Pid = 42, Low = 100 };
            var installerChild = new MsiResourceObservation.UniqueProcess { Pid = 43, Low = 101 };
            Check("onlyNewerDirectChildBelongsToSource",
                MsiResourceObservation.IsChildIdentity(expectedSource, installerChild, 43, 42) &&
                !MsiResourceObservation.IsChildIdentity(expectedSource, installerChild, 43, 41) &&
                !MsiResourceObservation.IsChildIdentity(expectedSource, installerChild, 44, 42) &&
                !MsiResourceObservation.IsChildIdentity(expectedSource, expectedSource, 42, 42) &&
                !MsiResourceObservation.IsChildIdentity(installerChild, expectedSource, 42, 43));
            var sourceObservation = new MsiSourceObservation("sourceReported", "alive", 3, 4, 5, 6);
            Check("sourceEvidenceRejectsUnorderedTiming", windowEvidence.Publish(prompt, 0, () => false, sourceFormatSample,
                sourceObservation with { ResourceQueryStartMs = 2 }) == "unavailable");
            Check("sourceEvidenceRejectsMissingResources", windowEvidence.Publish(prompt, 0, () => false,
                sourceObservation: sourceObservation) == "unavailable");
            Check("sourceEvidenceRecorded", windowEvidence.Publish(prompt, 0, () => false, sourceFormatSample, sourceObservation) == "recorded");
            if (timingEnabled)
            {
                Check("timingPositiveControlReleased", holder.Stop.Set());
                Check("timingPositiveControlExited", holder.Process.Wait(childExitTimeoutMs) && holder.Process.GetExitCode() == 0);
                timingArms.Add(TimingArm(false, evidence));
                timingArms.Add(TimingArm(true, evidence));
            }
        }
        catch (Exception error) { firstFailure = ExceptionDispatchInfo.Capture(error); }
        finally
        {
            foreach (var child in children) AttemptCleanup(() => child.Stop.Set());
            var exited = true;
            foreach (var child in children)
            {
                var signalled = false;
                AttemptCleanup(() => signalled = child.Process.Wait(5000));
                exited &= signalled;
            }
            if (!exited) { AttemptCleanup(() => own.Terminate()); AttemptCleanup(() => other.Terminate()); }
            try
            {
                foreach (var child in children) AttemptCleanup(() => Check("childExited" + children.IndexOf(child),
                    child.Process.Wait(5000) && child.Process.GetExitCode() == 0));
                AttemptCleanup(() => Check("bothTreesAbsent", own.GetActiveProcessCount() == 0 && other.GetActiveProcessCount() == 0));
                foreach (var name in names) AttemptCleanup(() => Check("bytesPreserved" + name,
                    File.ReadAllBytes(Path.Combine(payload, name)).AsSpan().SequenceEqual("SYNTHETIC RM RESOURCE"u8)));
                if (timingEnabled) AttemptCleanup(() => Check("timingBulkBytesPreserved", bulk.Length == resourceCount &&
                    bulk.All(name => File.ReadAllBytes(Path.Combine(payload, name)).AsSpan().SequenceEqual("SYNTHETIC RM RESOURCE"u8))));
            }
            finally
            {
                foreach (var child in children)
                {
                    AttemptCleanup(child.Process.Dispose);
                    AttemptCleanup(child.Stop.Dispose);
                }
                if (timingEnabled) AttemptCleanup(() => Check("timingChildHandlesClosed",
                    children.All(child => child.Process.HandlesClosed && child.Stop.SafeWaitHandle.IsClosed)));
            }
        }
        firstFailure?.Throw();
        var report = timingEnabled ? JsonSerializer.Serialize(new { schemaVersion = 1, checks,
            timing = new { releaseDelayMs, resourceCount, positiveControl = true, arms = timingArms } }) : JsonSerializer.Serialize(checks);
        File.WriteAllText(Path.Combine(request.WorkingDirectory, "msi-resource-contract.json"), report);
        return 0;

        void AttemptCleanup(Action cleanup)
        {
            try { cleanup(); }
            catch (Exception error) { firstFailure ??= ExceptionDispatchInfo.Capture(error); }
        }
        SourceQuery CaptureForSource(SuspendedWindowsProcess source, MsiResourceObservation.UniqueProcess birth,
            Action? afterWindowsQuery = null)
        {
            using var read = MsiResourceObservation.SourceRead.Retain(source, own, birth)
                ?? throw new InvalidOperationException("msiResourceContractFailed:retainSourceHandle");
            bool? liveBefore = null, liveAfter = null;
            var sample = MsiResourceObservation.Capture(request, own, () => true, payload,
                afterQuery: () => { afterWindowsQuery?.Invoke(); liveAfter = read.IsLive(); },
                beforeQuery: () => liveBefore = read.IsLive(), sourceRead: read);
            return new(sample, liveBefore, liveAfter);
        }
        object TimingArm(bool withQuery, SafeEvidenceWriter evidence)
        {
            var kind = withQuery ? "withQuery" : "withoutQuery";
            WriteSelection(bulk);
            var child = Start(own, bulk[0]);
            var identity = Identity(child.Process);
            Check("timing" + kind + "OwnedLiveAtReady", own.ContainsProcess(child.Process.Process) && !child.Process.Wait(0));
            int? captureEntryMs = null, afterQueryMs = null, captureReturnMs = null;
            string? entryState = null, afterQueryState = null, returnState = null;
            var releaseRequestedMs = -1;
            var exitObservedMs = -1;
            MsiResourceSample? sample = null;
            ExceptionDispatchInfo? armFailure = null;
            using var budget = new WorkspaceMsiActivityObservation(request.Scenario, own, evidence);
            var clock = Stopwatch.StartNew();
            // The release and direct-child wait must progress even while RM is blocked.
            var releaseThread = new Thread(() =>
            {
                try
                {
                    while (true)
                    {
                        var remaining = releaseDelayMs - clock.ElapsedMilliseconds;
                        if (remaining <= 0) break;
                        Thread.Sleep((int)remaining);
                    }
                    releaseRequestedMs = Elapsed();
                    if (!child.Stop.Set()) throw new InvalidOperationException("timingReleaseRequestFailed");
                    if (!child.Process.Wait(childExitTimeoutMs)) throw new InvalidOperationException("timingChildExitUnverified");
                    exitObservedMs = Elapsed();
                }
                catch (Exception error) { RecordFailure(error); }
            }) { IsBackground = true };
            var started = false;
            var releaseSettled = false;
            try
            {
                releaseThread.Start();
                started = true;
                if (withQuery)
                {
                    captureEntryMs = Elapsed();
                    entryState = State();
                    sample = MsiResourceObservation.Capture(request, own,
                        budget.ResourceAdmission(() => clock.ElapsedMilliseconds), payload, () =>
                        {
                            // Includes preceding selection and registration, not isolated RM latency.
                            afterQueryMs = Elapsed();
                            afterQueryState = State();
                        });
                    captureReturnMs = Elapsed();
                    returnState = State();
                }
            }
            catch (Exception error) { RecordFailure(error); }
            finally
            {
                if (started)
                {
                    try
                    {
                        releaseSettled = releaseThread.Join(releaseDelayMs + 2 * childExitTimeoutMs);
                        if (!releaseSettled) RecordFailure(new InvalidOperationException("timingReleaseSettlementUnverified"));
                    }
                    catch (Exception error) { RecordFailure(error); }
                }
            }
            Volatile.Read(ref armFailure)?.Throw();
            Check("timing" + kind + "ReleaseSettled", releaseSettled && releaseRequestedMs >= releaseDelayMs);
            Check("timing" + kind + "DirectChildExitObserved", exitObservedMs >= releaseRequestedMs && child.Process.Wait(0));
            var exitCode = child.Process.GetExitCode();
            Check("timing" + kind + "ExitSucceeded", exitCode == 0);
            if (withQuery) Check("timingwithQuerySessionClosed", sample is not null && sample.EndSessionCode is null or 0);
            var holderRows = sample?.Processes.Where(row => row.ProcessId == identity.Pid &&
                row.StartTimeLow == identity.Low && row.StartTimeHigh == identity.High).ToArray();
            return new { kind, captureEntryMs, afterQueryMs, captureReturnMs, releaseRequestedMs, exitObservedMs,
                entryState, afterQueryState, returnState, queryStatus = sample?.Status, queryPhase = sample?.Phase,
                nativeCode = sample?.NativeCode, endSessionCode = sample?.EndSessionCode,
                holderPresent = holderRows is null ? (bool?)null : holderRows.Length != 0,
                holderLiveOwned = holderRows is null ? (bool?)null : holderRows.Any(row => row.Membership == "ownedJob"),
                exitCode, releaseSettled };

            int Elapsed() => checked((int)clock.ElapsedMilliseconds);
            string State() => NativeMethods.WaitForSingleObject(child.Process.Process, 0) switch
            {
                NativeMethods.WaitTimeout => "live",
                NativeMethods.WaitObject0 => "exited",
                _ => "unknown",
            };
            void RecordFailure(Exception error) => Interlocked.CompareExchange(ref armFailure,
                ExceptionDispatchInfo.Capture(error), null);
        }
        void Check(string name, bool passed)
        { checks.Add(name, passed); if (!passed) throw new InvalidOperationException("msiResourceContractFailed:" + name); }
        void WriteSelection(string[] files, string? nonce = null, string? root = null) => File.WriteAllText(selectionPath,
            JsonSerializer.Serialize(new { schemaVersion = 1, runNonce = nonce ?? request.RunNonce, scenario = request.Scenario,
                artifactDescriptorSha256 = request.ArtifactDescriptorSha256, root = root ?? payload,
                selectionIdentity = new string('a', 64), files }));
        (SuspendedWindowsProcess Process, EventWaitHandle Stop) Start(WindowsJob job, string name)
        {
            var token = Guid.NewGuid().ToString("N");
            var readyName = "Local\\EkyResourceReady" + token;
            var stopName = "Local\\EkyResourceStop" + token;
            using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, readyName);
            var stop = new EventWaitHandle(false, EventResetMode.ManualReset, stopName);
            var input = Path.Combine(request.WorkingDirectory, "resource-child-" + token + ".json");
            File.WriteAllText(input, JsonSerializer.Serialize(new { ready = readyName, stop = stopName, file = Path.Combine(payload, name) }));
            var executable = Environment.ProcessPath!;
            var arguments = new List<string>();
            if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
                arguments.Add(Assembly.GetExecutingAssembly().Location);
            arguments.AddRange(["--mode", "msiResourceChild", "--request", input]);
            SuspendedWindowsProcess child;
            try { child = SuspendedWindowsProcess.Start(request with { Command = executable, Arguments = arguments }, job, CancellationToken.None); }
            catch { stop.Dispose(); throw; }
            children.Add((child, stop));
            child.Resume();
            Check("childReady" + children.Count, ready.WaitOne(5000));
            return (child, stop);
        }
        static MsiResourceObservation.UniqueProcess Identity(SuspendedWindowsProcess process)
        {
            if (!MsiResourceObservation.GetProcessTimes(process.Process, out var created, out _, out _, out _))
                throw new InvalidOperationException("processIdentityUnavailable");
            return new() { Pid = GetProcessId(process.Process), Low = created.Low, High = created.High };
        }
    }

    private sealed record SourceQuery(MsiResourceSample Sample, bool? LiveBefore, bool? LiveAfter);

    private static bool Matches(MsiResourceProcess row, MsiResourceObservation.UniqueProcess process) =>
        row.ProcessId == process.Pid && row.StartTimeLow == process.Low && row.StartTimeHigh == process.High;

    private static bool HasOwnedHolder(MsiResourceSample sample, MsiResourceObservation.UniqueProcess process) =>
        sample.Processes.Any(row => row.Membership == "ownedJob" && Matches(row, process));

    private static string SourceRelation(SourceQuery query, MsiResourceObservation.UniqueProcess source)
        => MsiResourceObservation.ClassifySource(query.Sample, source, query.LiveBefore is true && query.LiveAfter is true);

    [DllImport("kernel32.dll")] private static extern uint GetProcessId(Microsoft.Win32.SafeHandles.SafeProcessHandle process);
}
