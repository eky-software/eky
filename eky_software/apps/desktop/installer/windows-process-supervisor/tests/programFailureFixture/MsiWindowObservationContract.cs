using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

internal static class MsiWindowObservationContract
{
    private const int ColdProviderTimeoutHResult = unchecked((int)0x80131505);
    internal static int RunFailureReceipt(string requestPath)
    {
        if (!OperatingSystem.IsWindows()) return 63;
        SupervisorRequestReader.Read(["--request", requestPath]);
        MsiApplicationListFailure? listFailure = null;
        MsiApplicationListObservation.Read(IntPtr.Zero, 0, () => throw new InvalidOperationException("unexpectedAdmission"),
            () => 1000, 0, 100, out _, failure => listFailure = failure);
        var preparation = SampleReceipt(new(0, "partial", []), 1000, false,
            WorkspaceMsiMembership.Owned, new("listProcessId", "budgetExpired"));
        throw FirstSampleFailure(new(0, "partial", []), 0,
            () => throw new SupervisorFailure("processWaitFailed", 0), () => WorkspaceMsiMembership.Unknown, listFailure, preparation);
    }

    internal static int RunBoundFailureReceipt(string requestPath)
    {
        if (!OperatingSystem.IsWindows()) return 63;
        SupervisorRequestReader.Read(["--request", requestPath]);
        throw CheckFailure("largeListBounded", () => new
        {
            sample = SampleReceipt(new(0, "partial", []), 400, false, WorkspaceMsiMembership.Owned,
                new("firstChild", "providerException", ColdProviderTimeoutHResult)),
            windowCount = 0, maximumApplicationCharacters = 0, totalCharacters = 0,
        });
    }

    internal static int Run(string requestPath)
    {
        if (!OperatingSystem.IsWindows()) return 63;
        var request = SupervisorRequestReader.Read(["--request", requestPath]);
        var checks = new Dictionary<string, bool>();
        Func<object>? lastObservation = null;
        Check("checkObservationFailurePreservesName", CheckFailure("largeListBounded",
            () => throw new InvalidOperationException("unavailable observation")).Message ==
            "msiWindowContractFailed:largeListBounded:{\"lastObservation\":null}");
        var failedReceipt = FirstSampleFailure(new(0, "partial", []), 0,
            () => throw new SupervisorFailure("processWaitFailed", 0), () => WorkspaceMsiMembership.Unknown);
        Check("sampleFailurePreservedWhenExitQueryFails", failedReceipt.Message.StartsWith(
            "msiWindowContractFailed:titleCaptured:", StringComparison.Ordinal) &&
            failedReceipt.Message.Contains("\"childExitedAfterCapture\":null", StringComparison.Ordinal));
        using var own = WindowsJob.Create();
        using var other = WindowsJob.Create();
        var children = new List<(SuspendedWindowsProcess Process, EventWaitHandle Stop)>();
        object? preparationReceipt = null;
        try
        {
            var normal = Start(own, "normal");
            MsiWindowSample Observe(WindowsJob job, SuspendedWindowsProcess process, Func<bool>? stopped = null,
                int? characters = null, int? windows = null, Action<MsiApplicationListFailure>? listFailure = null)
            {
                var remaining = characters ?? MsiWindowObservation.Contract.MaximumTotalCharacters;
                var slots = windows ?? MsiWindowObservation.Contract.MaximumWindows;
                var timer = Stopwatch.StartNew();
                MsiApplicationListFailure? firstFailure = null;
                var sample = MsiWindowObservation.Capture(job, process.Process, stopped ?? (() => false),
                    timer, ref remaining, ref slots, failure => { firstFailure ??= failure; listFailure?.Invoke(failure); });
                timer.Stop();
                lastObservation = () => new
                {
                    sample = SampleReceipt(sample, timer.ElapsedMilliseconds, ExitState(() => process.Wait(0)),
                        MembershipState(() => WorkspaceMsiActivityObservation.ObserveHandle(job, process.Process)), firstFailure),
                    windowCount = sample.Windows.Count,
                    maximumApplicationCharacters = sample.Windows.Where(row => row.Role == "application")
                        .Select(row => row.Text.Length).DefaultIfEmpty(0).Max(),
                    totalCharacters = sample.Windows.Sum(row => row.Text.Length),
                };
                return sample;
            }
            Check("systemImageAdmitted", MsiWindowObservation.IsSystemInstaller(Path.Combine(Environment.SystemDirectory, "msiexec.exe")));
            Check("otherImageRejected", !MsiWindowObservation.IsSystemInstaller(Path.Combine(request.WorkingDirectory, "msiexec.exe")));
            Check("firstSampleIsolatedFromOtherCases", children.Count == 1);
            var coldTimer = Stopwatch.StartNew();
            MsiApplicationListFailure? coldFailure = null;
            var cold = Observe(own, normal.Process, listFailure: failure => coldFailure ??= failure);
            coldTimer.Stop();
            var coldExited = ExitState(() => normal.Process.Wait(0));
            var coldMembership = MembershipState(() => WorkspaceMsiActivityObservation.ObserveHandle(own, normal.Process.Process));
            if (!PreparationAllowed(cold, coldTimer.ElapsedMilliseconds, coldExited, coldMembership, coldFailure))
            {
                throw FirstSampleFailure(cold, coldTimer.ElapsedMilliseconds,
                    () => coldExited, () => coldMembership, coldFailure);
            }
            var preparation = SampleReceipt(cold, coldTimer.ElapsedMilliseconds, coldExited, coldMembership, coldFailure);
            preparationReceipt = preparation;
            var measuredTimer = Stopwatch.StartNew();
            MsiApplicationListFailure? measuredFailure = null;
            var observed = Observe(own, normal.Process, listFailure: failure => measuredFailure ??= failure);
            measuredTimer.Stop();
            if (!CompleteSample(observed) || measuredFailure is not null)
                throw FirstSampleFailure(observed, measuredTimer.ElapsedMilliseconds,
                    () => normal.Process.Wait(0),
                    () => WorkspaceMsiActivityObservation.ObserveHandle(own, normal.Process.Process), measuredFailure, preparation);
            Check("coldSampleRetained", cold.Status is "observed" or "partial");
            Check("preparedSampleComplete", CompleteSample(observed) && measuredFailure is null);
            var budgetFailure = new MsiApplicationListFailure("listProcessId", "budgetExpired");
            var partial = cold with { Status = "partial", Windows = observed.Windows.Where(row => row.Role != "application").ToArray() };
            var budget = MsiWindowObservation.Contract.SampleTimeoutMilliseconds;
            Check("preparationAllowsExactBudgetExpiry", PreparationAllowed(partial, budget, false, WorkspaceMsiMembership.Owned, budgetFailure));
            Check("preparationAllowsCompleteSample", PreparationAllowed(observed, 0, false, WorkspaceMsiMembership.Owned, null));
            foreach (var stage in new[] { "elementFromHandle", "firstChild" })
            {
                var timeout = new MsiApplicationListFailure(stage, "providerException", ColdProviderTimeoutHResult);
                Check("preparationAllowsExactProviderTimeout" + stage,
                    PreparationAllowed(partial, 400, false, WorkspaceMsiMembership.Owned, timeout));
                Check("providerTimeoutRejectsExitedOwner" + stage,
                    !PreparationAllowed(partial, 400, true, WorkspaceMsiMembership.Owned, timeout));
                Check("providerTimeoutRejectsUnknownOwner" + stage,
                    !PreparationAllowed(partial, 400, false, WorkspaceMsiMembership.Unknown, timeout));
                Check("providerTimeoutRejectsUnknownExit" + stage,
                    !PreparationAllowed(partial, 400, null, WorkspaceMsiMembership.Owned, timeout));
                Check("providerTimeoutRejectsPartialApplications" + stage,
                    !PreparationAllowed(observed with { Status = "partial" }, 400, false, WorkspaceMsiMembership.Owned, timeout));
                Check("providerTimeoutRejectsMissingRoles" + stage, new[] { "title", "message", "button" }.All(role =>
                    !PreparationAllowed(partial with { Windows = partial.Windows.Where(row => row.Role != role).ToArray() },
                        400, false, WorkspaceMsiMembership.Owned, timeout)));
            }
            Check("preparationRejectsOtherFailures", new[] {
                new MsiApplicationListFailure("listProcessId", "providerException", unchecked((int)0x80004005)),
                new MsiApplicationListFailure("elementFromHandle", "providerException", unchecked((int)0x80004005)),
                new MsiApplicationListFailure("elementFromHandle", "providerException"),
                new MsiApplicationListFailure("itemProcessId", "providerException", ColdProviderTimeoutHResult),
                new MsiApplicationListFailure("elementFromHandle", "admissionLost", ColdProviderTimeoutHResult),
                new MsiApplicationListFailure("itemProcessId", "budgetExpired"),
                new MsiApplicationListFailure("listProcessId", "admissionLost"),
                new MsiApplicationListFailure("listProcessId", "budgetExpired", 1),
            }.All(failure => !PreparationAllowed(partial, budget, false, WorkspaceMsiMembership.Owned, failure)));
            Check("preparationRejectsMissingReason", !PreparationAllowed(partial, budget, false, WorkspaceMsiMembership.Owned, null));
            Check("preparationRejectsEarlyExpiry", !PreparationAllowed(partial, budget - 1, false, WorkspaceMsiMembership.Owned, budgetFailure));
            Check("preparationRejectsExitedOwner", !PreparationAllowed(partial, budget, true, WorkspaceMsiMembership.Owned, budgetFailure));
            var unknownExit = ExitState(() => throw new SupervisorFailure("processWaitFailed", 0));
            Check("preparationRejectsUnknownExit", unknownExit is null &&
                !PreparationAllowed(partial, budget, unknownExit, WorkspaceMsiMembership.Owned, budgetFailure));
            using (var receipt = JsonDocument.Parse(FirstSampleFailure(partial, budget,
                () => unknownExit, () => WorkspaceMsiMembership.Owned, budgetFailure).Message.Split(':', 3)[2]))
            {
                var sample = receipt.RootElement.GetProperty("sample");
                Check("coldExitQueryFailureRetainsSample", sample.GetProperty("status").GetString() == "partial" &&
                    sample.GetProperty("childExitedAfterCapture").ValueKind == JsonValueKind.Null &&
                    sample.GetProperty("listFailure").GetProperty("Reason").GetString() == "budgetExpired");
            }
            Check("preparationRejectsUnknownOwner", !PreparationAllowed(partial, budget, false, WorkspaceMsiMembership.Unknown, budgetFailure));
            Check("preparationRejectsFailedOwnershipQuery", !PreparationAllowed(partial, budget, false,
                MembershipState(() => throw new SupervisorFailure("processWaitFailed", 0)), budgetFailure));
            Check("preparationRejectsMissingRoles", new[] { "title", "message", "button" }.All(role =>
                !PreparationAllowed(partial with { Windows = partial.Windows.Where(row => row.Role != role).ToArray() },
                    budget, false, WorkspaceMsiMembership.Owned, budgetFailure)));
            Check("preparationRejectsPartialApplications", !PreparationAllowed(observed with { Status = "partial" },
                budget, false, WorkspaceMsiMembership.Owned, budgetFailure));
            Check("preparationRejectsUnknownStatus", !PreparationAllowed(partial with { Status = "unavailable" },
                budget, false, WorkspaceMsiMembership.Owned, budgetFailure));
            Check("measuredFailureKeepsPreparation", FirstSampleFailure(new(0, "partial", []), 0,
                () => false, () => WorkspaceMsiMembership.Owned, budgetFailure, preparation).Message.Contains(
                    "\"preparation\":{", StringComparison.Ordinal));
            Check("titleCaptured", true);
            Check("messageCaptured", observed.Windows.Any(row => row.Role == "message" && MsiWindowObservation.IsApplicationsInUseMessage(row.Text)));
            Check("buttonCaptured", observed.Windows.Any(row => row.Role == "button" && row.Text == "Synthetic cancel"));
            Check("applicationCaptured", observed.Windows.Any(row => row.Role == "application" && row.Text == "SYNTHETIC OWNED APPLICATION"));
            var unrelated = Start(own, "unrelated");
            Check("unrelatedListExcluded", Observe(own, unrelated.Process).Windows.All(row => row.Role != "application"));
            var ambiguous = Start(own, "ambiguous");
            Check("ambiguousListsExcluded", Observe(own, ambiguous.Process).Windows.All(row => row.Role != "application"));
            var wrongParent = Start(own, "wrongParent");
            Check("wrongParentExcluded", Observe(own, wrongParent.Process).Windows.Count == 0);
            var changedMessage = Start(own, "changedMessage");
            MsiApplicationListFailure? changedMessageFailure = null;
            var changed = Observe(own, changedMessage.Process,
                listFailure: failure => changedMessageFailure ??= failure);
            Check("changedMessageExcluded", changed.Status == "partial" && changed.Windows.All(row => row.Role != "application"));
            Check("changedMessageCauseRetained", changedMessageFailure is not null);
            var listHung = Start(own, "listHung");
            var listTimer = Stopwatch.StartNew();
            MsiApplicationListFailure? hungListFailure = null;
            Check("unresponsiveListPartial", Observe(own, listHung.Process,
                listFailure: failure => hungListFailure ??= failure).Status == "partial");
            Check("unresponsiveListBounded", listTimer.ElapsedMilliseconds < 2000);
            Check("unresponsiveListCauseRetained", hungListFailure is not null &&
                hungListFailure.Reason is "budgetExpired" or "admissionLost" or "providerException");
            Check("nativeExceptionCodeRetained", hungListFailure?.Reason != "providerException" ||
                hungListFailure.HResult is not null);
            var largeList = Start(own, "largeList");
            var large = Observe(own, largeList.Process);
            Check("largeListBounded", large.Status == "partial" &&
                large.Windows.Any(row => row.Role == "application" && row.Text.Length == MsiWindowObservation.Contract.MaximumTextCharacters) &&
                large.Windows.Count <= MsiWindowObservation.Contract.MaximumWindows &&
                large.Windows.Sum(row => row.Text.Length) <= MsiWindowObservation.Contract.MaximumTotalCharacters);
            var admissionCalls = 0;
            var reportedFailures = new List<MsiApplicationListFailure>();
            var empty = MsiApplicationListObservation.Read(IntPtr.Zero, 0, () => { admissionCalls++; return true; },
                () => 1000, 0, 100, out var emptyPartial, reportedFailures.Add);
            Check("emptyBudgetSkipsProvider", emptyPartial && empty.Count == 0 && admissionCalls == 0);
            Check("firstListFailureRetained", reportedFailures.Count == 1 &&
                reportedFailures[0] == new MsiApplicationListFailure("admission", "outputLimit"));
            reportedFailures.Clear();
            var denied = MsiApplicationListObservation.Read(IntPtr.Zero, 0, () => false,
                () => throw new InvalidOperationException("unexpectedBudgetQuery"), 1, 100, out var deniedPartial, reportedFailures.Add);
            Check("deniedListSkipsProvider", deniedPartial && denied.Count == 0 && reportedFailures.Count == 1 &&
                reportedFailures[0] == new MsiApplicationListFailure("admission", "admissionLost"));
            Check("editNotRead", observed.Windows.All(row => !row.Text.Contains("EXCLUDED INPUT", StringComparison.Ordinal)));
            var outsider = Start(other, "normal");
            Check("foreignJobRejected", Observe(own, outsider.Process) is { Status: "unavailable", Windows.Count: 0 });
            Check("otherJobPositiveControl", Observe(other, outsider.Process).Windows.Count > 0);
            var hidden = Start(own, "hidden");
            Check("hiddenExcluded", Observe(own, hidden.Process) is { Status: "observed", Windows.Count: 0 });
            var hung = Start(own, "hung");
            var timer = Stopwatch.StartNew();
            var blocked = Observe(own, hung.Process);
            Check("hungReadBounded", timer.ElapsedMilliseconds < 2000);
            Check("hungReadPartial", blocked is { Status: "partial", Windows.Count: 0 });
            Check("cancelledExcluded", Observe(own, normal.Process, () => true) is { Status: "unavailable", Windows.Count: 0 });
            Check("characterLimit", Observe(own, normal.Process, characters: 8) is { Status: "partial", Windows.Count: 1 });
            Check("controlLimit", Observe(own, normal.Process, windows: 1) is { Status: "partial", Windows.Count: 1 });
            Check("allStillRunning", children.All(child => !child.Process.Wait(0)));

            var evidence = new MsiWindowEvidence(request);
            evidence.Publish([cold, observed, blocked], 123, () => false);
            var first = Path.Combine(Path.GetDirectoryName(request.ResultPath)!, "msi-window-001.private.json");
            Check("firstPublished", File.Exists(first));
            var original = File.ReadAllBytes(first);
            var pending = Path.Combine(Path.GetDirectoryName(request.ResultPath)!, "msi-window-002.private.json.pending");
            evidence.Publish([observed], 124, () => File.Exists(pending));
            Check("cancelBeforePublicationRetainsPending", File.Exists(pending) && !File.Exists(pending[..^8]));
            Check("earlierEvidenceUnchanged", File.ReadAllBytes(first).SequenceEqual(original));
            var conflict = new MsiWindowEvidence(request);
            conflict.Publish([observed], 125, () => false);
            Check("exclusivePublicationPreservesFirst", File.ReadAllBytes(first).SequenceEqual(original));
            evidence.Publish([observed], 126, () => true);
            Check("stoppedNoNextSample", !File.Exists(Path.Combine(Path.GetDirectoryName(first)!, "msi-window-003.private.json")));

            var lockedRoot = Path.Combine(request.WorkingDirectory, "reserved-window-output");
            Directory.CreateDirectory(lockedRoot);
            var lockedRequest = request with { ResultPath = Path.Combine(lockedRoot, "result.json") };
            var heldPublisher = new MsiWindowEvidence(lockedRequest, () =>
            {
                var blockedRename = false;
                try { Directory.Move(lockedRoot, lockedRoot + ".moved"); }
                catch (IOException) { blockedRename = true; }
                Check("parentSwapBlockedDuringWrite", blockedRename);
            });
            Check("reservedPublication", heldPublisher.Publish([observed], 127, () => false) == "recorded");
            Directory.Move(lockedRoot, lockedRoot + ".moved");
            Check("reservationReleasedAfterPublication", File.Exists(Path.Combine(lockedRoot + ".moved", "msi-window-001.private.json")));

            var blockedRoot = Path.Combine(request.WorkingDirectory, "blocked-window-output");
            Directory.CreateDirectory(blockedRoot);
            using var writeStarted = new ManualResetEventSlim(false);
            using var writeRelease = new ManualResetEventSlim(false);
            var output = new StringWriter();
            var prior = Console.Out;
            Console.SetOut(output);
            var safeEvidence = new SafeEvidenceWriter(request.Scenario, Stopwatch.StartNew());
            Console.SetOut(prior);
            var writeCalls = 0;
            using (var observation = new WorkspaceMsiActivityObservation(request.Scenario, own, safeEvidence,
                request: request with { ResultPath = Path.Combine(blockedRoot, "result.json") }, beforeWindowWrite: () =>
                { Interlocked.Increment(ref writeCalls); writeStarted.Set(); writeRelease.Wait(); }))
            {
                try
                {
                    observation.Poll(0);
                    Check("integratedWriteStarted", writeStarted.Wait(5000));
                    var pendingRead = observation.PendingRead!;
                    observation.Dispose();
                    Check("disposeDoesNotWaitForWrite", !pendingRead.IsCompleted);
                    writeRelease.Set();
                    Check("stoppedWriteFinishes", pendingRead.Wait(5000));
                    observation.Poll(60000);
                    Check("noNextWriteAfterStop", writeCalls == 1);
                    Check("noLateFileAfterStop", Directory.GetFiles(blockedRoot).Length == 0);
                }
                finally { writeRelease.Set(); }
            }
            safeEvidence.CompleteWithinRequestBudget(5000);
            Check("onlySafePendingDelivery", output.ToString().Contains("\"phase\":\"msiWindowEvidence\",\"status\":\"pending\"", StringComparison.Ordinal));
            Check("noLateRecordedDelivery", !output.ToString().Contains("recorded", StringComparison.Ordinal));
            Check("noRawPublicText", !output.ToString().Contains("SYNTHETIC MSI", StringComparison.Ordinal));
            normal.Stop.Set();
            Check("normalExit", normal.Process.Wait(5000) && normal.Process.GetExitCode() == 0);
            Check("exitedHandleRejected", Observe(own, normal.Process) is { Status: "unavailable", Windows.Count: 0 });
        }
        finally
        {
            foreach (var child in children) child.Stop.Set();
            var exited = children.All(child => child.Process.Wait(5000));
            if (!exited) { own.Terminate(); other.Terminate(); }
            foreach (var child in children) { child.Process.Wait(5000); child.Process.Dispose(); child.Stop.Dispose(); }
            Check("cleanupVerified", own.GetActiveProcessCount() == 0 && other.GetActiveProcessCount() == 0);
        }
        File.WriteAllText(Path.Combine(request.WorkingDirectory, "msi-window-contract.json"),
            JsonSerializer.Serialize(new { checks, preparation = preparationReceipt }));
        return 0;

        void Check(string name, bool passed)
        {
            checks.Add(name, passed);
            if (!passed) throw CheckFailure(name, lastObservation);
        }
        (SuspendedWindowsProcess Process, EventWaitHandle Stop) Start(WindowsJob job, string behavior)
        {
            var token = Guid.NewGuid().ToString("N");
            var readyName = "Local\\EkyWindowReady" + token;
            var stopName = "Local\\EkyWindowStop" + token;
            using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, readyName);
            var stop = new EventWaitHandle(false, EventResetMode.ManualReset, stopName);
            var input = Path.Combine(request.WorkingDirectory, "window-child-" + token + ".json");
            File.WriteAllText(input, JsonSerializer.Serialize(new { readyName, stopName, behavior }));
            var executable = Environment.ProcessPath!;
            var args = new List<string>();
            if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
                args.Add(Assembly.GetExecutingAssembly().Location);
            args.AddRange(["--mode", "msiWindowChild", "--request", input]);
            var process = SuspendedWindowsProcess.Start(request with { Command = executable, Arguments = args }, job, CancellationToken.None);
            children.Add((process, stop));
            process.Resume();
            Check("childReady" + children.Count, ready.WaitOne(5000));
            return (process, stop);
        }
    }

    private static InvalidOperationException CheckFailure(string name, Func<object>? observe)
    {
        object? lastObservation = null;
        try { lastObservation = observe?.Invoke(); } catch { }
        return new InvalidOperationException("msiWindowContractFailed:" + name + ":" +
            JsonSerializer.Serialize(new { lastObservation }));
    }

    private static bool ExpectedRole(MsiWindowSample sample, string role) => sample.Windows.Any(row => row.Role == role && (role switch
    {
        "title" => row.Text == "SYNTHETIC MSI WINDOW",
        "message" => MsiWindowObservation.IsApplicationsInUseMessage(row.Text),
        "button" => row.Text == "Synthetic cancel",
        "application" => row.Text == "SYNTHETIC OWNED APPLICATION",
        _ => false,
    }));

    private static bool CompleteSample(MsiWindowSample sample) => sample.Status == "observed" &&
        new[] { "title", "message", "button", "application" }.All(role => ExpectedRole(sample, role));

    private static bool PreparationAllowed(MsiWindowSample sample, long elapsedMilliseconds, bool? exited,
        WorkspaceMsiMembership membership, MsiApplicationListFailure? failure) =>
        exited is false && membership == WorkspaceMsiMembership.Owned &&
        (CompleteSample(sample) && failure is null || sample.Status == "partial" &&
            (failure == new MsiApplicationListFailure("listProcessId", "budgetExpired") &&
                elapsedMilliseconds >= MsiWindowObservation.Contract.SampleTimeoutMilliseconds ||
             failure is { Stage: "elementFromHandle" or "firstChild", Reason: "providerException", HResult: ColdProviderTimeoutHResult } &&
                elapsedMilliseconds >= 0) &&
            new[] { "title", "message", "button" }.All(role => ExpectedRole(sample, role)) &&
            sample.Windows.All(row => row.Role != "application"));

    private static object SampleReceipt(MsiWindowSample observed, long elapsedMilliseconds, bool? childExitedAfterCapture,
        WorkspaceMsiMembership membership, MsiApplicationListFailure? listFailure) => new
        {
            status = observed.Status,
            titleCaptured = ExpectedRole(observed, "title"),
            messageCaptured = ExpectedRole(observed, "message"),
            buttonCaptured = ExpectedRole(observed, "button"),
            applicationCaptured = ExpectedRole(observed, "application"),
            elapsedMilliseconds,
            childExitedAfterCapture,
            membershipAfterCapture = membership.ToString(),
            listFailure,
        };

    private static bool? ExitState(Func<bool?> hasExited)
    {
        try { return hasExited(); } catch { return null; }
    }

    private static WorkspaceMsiMembership MembershipState(Func<WorkspaceMsiMembership> membership)
    {
        try { return membership(); } catch { return WorkspaceMsiMembership.Unknown; }
    }

    private static InvalidOperationException FirstSampleFailure(MsiWindowSample observed, long elapsedMilliseconds,
        Func<bool?> hasExited, Func<WorkspaceMsiMembership> membership, MsiApplicationListFailure? listFailure = null,
        object? preparation = null)
    {
        var sample = SampleReceipt(observed, elapsedMilliseconds, ExitState(hasExited), MembershipState(membership), listFailure);
        return new InvalidOperationException("msiWindowContractFailed:titleCaptured:" +
            JsonSerializer.Serialize(new { sample, preparation }));
    }

    internal static int Child(string inputPath)
    {
        if (!OperatingSystem.IsWindows()) return 63;
        using var input = JsonDocument.Parse(File.ReadAllText(inputPath));
        using var ready = EventWaitHandle.OpenExisting(input.RootElement.GetProperty("readyName").GetString()!);
        using var stop = EventWaitHandle.OpenExisting(input.RootElement.GetProperty("stopName").GetString()!);
        var behavior = input.RootElement.GetProperty("behavior").GetString();
        var visible = behavior == "hidden" ? 0u : 0x10000000u;
        var window = CreateWindowEx(0x08000000, behavior == "wrongParent" ? "BUTTON" : "STATIC", "SYNTHETIC MSI WINDOW", visible,
            -32000, -32000, 100, 100, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (window == IntPtr.Zero) return 65;
        WindowProcedure? listProcedure = null;
        try
        {
            var messageWindow = IntPtr.Zero;
            foreach (var (type, text) in new[] { ("STATIC", behavior == "unrelated" ? "SYNTHETIC OTHER DIALOG" :
                "The following applications should be closed before continuing the installation:"),
                ("BUTTON", "Synthetic cancel"), ("EDIT", "EXCLUDED INPUT") })
            {
                var child = CreateWindowEx(0, type, text, visible | 0x40000000u, 0, 0, 80, 20,
                    window, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (child == IntPtr.Zero) return 66;
                if (type == "STATIC") messageWindow = child;
            }
            var list = CreateWindowEx(0, "LISTBOX", "", visible | 0x40000000u, 0, 30, 80, 40,
                window, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (list == IntPtr.Zero) return 66;
            SendMessage(list, 0x0180, UIntPtr.Zero, "SYNTHETIC OWNED APPLICATION");
            if (behavior == "largeList")
                for (var index = 0; index < 40; index++) SendMessage(list, 0x0180, UIntPtr.Zero, new string('X', 1500));
            if (behavior == "ambiguous" && CreateWindowEx(0, "LISTBOX", "", visible | 0x40000000u, 0, 70, 80, 20,
                window, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero) == IntPtr.Zero) return 66;
            if (behavior is "listHung" or "changedMessage")
            {
                var original = IntPtr.Zero;
                listProcedure = (handle, message, wParam, lParam) =>
                {
                    if (message is 0x003D or 0x018B)
                    {
                        if (behavior == "listHung") stop.WaitOne(10000);
                        else SetWindowText(messageWindow, "SYNTHETIC CHANGED MESSAGE");
                    }
                    return CallWindowProc(original, handle, message, wParam, lParam);
                };
                original = SetWindowLongPtr(list, -4, Marshal.GetFunctionPointerForDelegate(listProcedure));
                if (original == IntPtr.Zero) return 68;
            }
            ready.Set();
            var lifetime = Stopwatch.StartNew();
            while (lifetime.ElapsedMilliseconds < 15000 && !stop.WaitOne(1))
            {
                if (behavior == "hung") continue;
                while (PeekMessage(out var message, IntPtr.Zero, 0, 0, 1))
                { TranslateMessage(ref message); DispatchMessage(ref message); }
            }
            return stop.WaitOne(0) ? 0 : 67;
        }
        finally { DestroyWindow(window); GC.KeepAlive(listProcedure); }
    }
    private delegate IntPtr WindowProcedure(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] private struct Message
    { public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam; public uint Time; public int X; public int Y; public uint Private; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowEx(uint extendedStyle,
        string className, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr window,
        uint message, UIntPtr wParam, string text);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CallWindowProc(IntPtr procedure,
        IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SetWindowLongPtr(IntPtr window,
        int index, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetWindowText(IntPtr window, string value);
}
