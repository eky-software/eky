using System.Diagnostics;
using System.Reflection;
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
        var payload = Path.Combine(request.WorkingDirectory, "payload");
        Directory.CreateDirectory(payload);
        var names = new[] { "owned.bin", "other.bin", "unused.bin" };
        foreach (var name in names) File.WriteAllBytes(Path.Combine(payload, name), "SYNTHETIC RM RESOURCE"u8.ToArray());
        var selectionPath = Path.Combine(request.WorkingDirectory, MsiWindowObservation.Contract.ResourceSelectionFilename);
        var children = new List<(SuspendedWindowsProcess Process, EventWaitHandle Stop)>();
        using var own = WindowsJob.Create();
        using var other = WindowsJob.Create();
        MsiResourceSample? observed = null;
        try
        {
            Check("missingSelectionUnavailable", MsiResourceSelection.Read(request, () => true, payload) is null);
            WriteSelection(names);
            Check("validSelectionAdmitted", MsiResourceSelection.Read(request, () => true, payload)?.Files.Length == 3);
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
            WriteSelection([names[0]]);
            observed = MsiResourceObservation.Capture(request, own, () => true, payload);
            Check("registeredHolderObserved", observed.Status == "observed" && observed.Processes.Any(row =>
                row.ProcessId == aIdentity.Pid && row.StartTimeLow == aIdentity.Low && row.StartTimeHigh == aIdentity.High && row.Membership == "ownedJob"));
            Check("unregisteredHolderExcluded", observed.Processes.All(row => row.ProcessId != bIdentity.Pid));
            Check("sessionClosed", observed.NativeCode == 0 && observed.EndSessionCode == 0);
            WriteSelection([names[1]]);
            var external = MsiResourceObservation.Capture(request, own, () => true, payload);
            Check("outsideJobObserved", external.Status == "observed" && external.Processes.Any(row =>
                row.ProcessId == bIdentity.Pid && row.Membership == "outsideJob"));
            WriteSelection([names[2]]);
            var empty = MsiResourceObservation.Capture(request, own, () => true, payload);
            Check("emptyObservedDistinct", empty.Status == "observed" && empty.Processes.Count == 0 && empty.EndSessionCode == 0);
            Check("staleCreationUnknown", MsiResourceObservation.Membership(new() { Pid = aIdentity.Pid,
                Low = aIdentity.Low ^ 1, High = aIdentity.High }, own) == "unknown");
            var callbackReached = false;
            var exited = false;
            var membership = MsiResourceObservation.Membership(aIdentity, own, () =>
            { callbackReached = true; a.Stop.Set(); exited = a.Process.Wait(5000) && a.Process.GetExitCode() == 0; });
            Check("exitDuringReadVerified", callbackReached && exited && membership == "unknown");
            Check("exitedUnknown", MsiResourceObservation.Membership(aIdentity, own) == "unknown");
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
            Check("resourceEvidenceRecorded", new MsiWindowEvidence(request).Publish(prompt, 0, () => false, observed) == "recorded");
        }
        finally
        {
            foreach (var child in children) child.Stop.Set();
            var exited = true;
            foreach (var child in children) if (!child.Process.Wait(5000)) exited = false;
            if (!exited) { own.Terminate(); other.Terminate(); }
            try
            {
                foreach (var child in children) Check("childExited" + children.IndexOf(child), child.Process.Wait(5000) && child.Process.GetExitCode() == 0);
                Check("bothTreesAbsent", own.GetActiveProcessCount() == 0 && other.GetActiveProcessCount() == 0);
                foreach (var name in names) Check("bytesPreserved" + name,
                    File.ReadAllBytes(Path.Combine(payload, name)).AsSpan().SequenceEqual("SYNTHETIC RM RESOURCE"u8));
            }
            finally { foreach (var child in children) { child.Process.Dispose(); child.Stop.Dispose(); } }
        }
        File.WriteAllText(Path.Combine(request.WorkingDirectory, "msi-resource-contract.json"), JsonSerializer.Serialize(checks));
        return 0;

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

    [DllImport("kernel32.dll")] private static extern uint GetProcessId(Microsoft.Win32.SafeHandles.SafeProcessHandle process);
}
