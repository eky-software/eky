using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

internal static class MsiWindowObservationContract
{
    internal static int RunFailureReceipt(string requestPath)
    {
        SupervisorRequestReader.Read(["--request", requestPath]);
        throw FirstSampleFailure(new(0, "partial", []), 0,
            () => throw new SupervisorFailure("processWaitFailed", 0), () => WorkspaceMsiMembership.Unknown);
    }

    internal static int Run(string requestPath)
    {
        if (!OperatingSystem.IsWindows()) return 63;
        var request = SupervisorRequestReader.Read(["--request", requestPath]);
        var checks = new Dictionary<string, bool>();
        var failedReceipt = FirstSampleFailure(new(0, "partial", []), 0,
            () => throw new SupervisorFailure("processWaitFailed", 0), () => WorkspaceMsiMembership.Unknown);
        Check("sampleFailurePreservedWhenExitQueryFails", failedReceipt.Message.StartsWith(
            "msiWindowContractFailed:titleCaptured:", StringComparison.Ordinal) &&
            failedReceipt.Message.Contains("\"childExitedAfterCapture\":null", StringComparison.Ordinal));
        using var own = WindowsJob.Create();
        using var other = WindowsJob.Create();
        var children = new List<(SuspendedWindowsProcess Process, EventWaitHandle Stop)>();
        try
        {
            var normal = Start(own, "normal");
            var outsider = Start(other, "normal");
            var hung = Start(own, "hung");
            var hidden = Start(own, "hidden");
            var unrelated = Start(own, "unrelated");
            var listHung = Start(own, "listHung");
            var largeList = Start(own, "largeList");
            var ambiguous = Start(own, "ambiguous");
            var wrongParent = Start(own, "wrongParent");
            var changedMessage = Start(own, "changedMessage");
            MsiWindowSample Observe(WindowsJob job, SuspendedWindowsProcess process, Func<bool>? stopped = null,
                int? characters = null, int? windows = null)
            {
                var remaining = characters ?? MsiWindowObservation.Contract.MaximumTotalCharacters;
                var slots = windows ?? MsiWindowObservation.Contract.MaximumWindows;
                return MsiWindowObservation.Capture(job, process.Process, stopped ?? (() => false),
                    Stopwatch.StartNew(), ref remaining, ref slots);
            }
            Check("systemImageAdmitted", MsiWindowObservation.IsSystemInstaller(Path.Combine(Environment.SystemDirectory, "msiexec.exe")));
            Check("otherImageRejected", !MsiWindowObservation.IsSystemInstaller(Path.Combine(request.WorkingDirectory, "msiexec.exe")));
            var firstCapture = Stopwatch.StartNew();
            var observed = Observe(own, normal.Process);
            firstCapture.Stop();
            var titleCaptured = observed.Windows.Any(row => row.Role == "title" && row.Text == "SYNTHETIC MSI WINDOW");
            if (observed.Status != "observed" || !titleCaptured)
            {
                // Preserve the failed sample's closed classifications in the existing
                // private fixture stderr. Do not probe again or print window text.
                throw FirstSampleFailure(observed, firstCapture.ElapsedMilliseconds,
                    () => normal.Process.Wait(0),
                    () => WorkspaceMsiActivityObservation.ObserveHandle(own, normal.Process.Process));
            }
            Check("titleCaptured", true);
            Check("messageCaptured", observed.Windows.Any(row => row.Role == "message" && MsiWindowObservation.IsApplicationsInUseMessage(row.Text)));
            Check("buttonCaptured", observed.Windows.Any(row => row.Role == "button" && row.Text == "Synthetic cancel"));
            Check("applicationCaptured", observed.Windows.Any(row => row.Role == "application" && row.Text == "SYNTHETIC OWNED APPLICATION"));
            Check("unrelatedListExcluded", Observe(own, unrelated.Process).Windows.All(row => row.Role != "application"));
            Check("ambiguousListsExcluded", Observe(own, ambiguous.Process).Windows.All(row => row.Role != "application"));
            Check("wrongParentExcluded", Observe(own, wrongParent.Process).Windows.Count == 0);
            var changed = Observe(own, changedMessage.Process);
            Check("changedMessageExcluded", changed.Status == "partial" && changed.Windows.All(row => row.Role != "application"));
            var listTimer = Stopwatch.StartNew();
            Check("unresponsiveListPartial", Observe(own, listHung.Process).Status == "partial");
            Check("unresponsiveListBounded", listTimer.ElapsedMilliseconds < 2000);
            var large = Observe(own, largeList.Process);
            Check("largeListBounded", large.Status == "partial" &&
                large.Windows.Any(row => row.Role == "application" && row.Text.Length == MsiWindowObservation.Contract.MaximumTextCharacters) &&
                large.Windows.Count <= MsiWindowObservation.Contract.MaximumWindows &&
                large.Windows.Sum(row => row.Text.Length) <= MsiWindowObservation.Contract.MaximumTotalCharacters);
            var admissionCalls = 0;
            var empty = MsiApplicationListObservation.Read(IntPtr.Zero, 0, () => { admissionCalls++; return true; },
                () => 1000, 0, 100, out var emptyPartial);
            Check("emptyBudgetSkipsProvider", emptyPartial && empty.Count == 0 && admissionCalls == 0);
            Check("editNotRead", observed.Windows.All(row => !row.Text.Contains("EXCLUDED INPUT", StringComparison.Ordinal)));
            Check("foreignJobRejected", Observe(own, outsider.Process) is { Status: "unavailable", Windows.Count: 0 });
            Check("otherJobPositiveControl", Observe(other, outsider.Process).Windows.Count > 0);
            Check("hiddenExcluded", Observe(own, hidden.Process) is { Status: "observed", Windows.Count: 0 });
            var timer = Stopwatch.StartNew();
            var blocked = Observe(own, hung.Process);
            Check("hungReadBounded", timer.ElapsedMilliseconds < 2000);
            Check("hungReadPartial", blocked is { Status: "partial", Windows.Count: 0 });
            Check("cancelledExcluded", Observe(own, normal.Process, () => true) is { Status: "unavailable", Windows.Count: 0 });
            Check("characterLimit", Observe(own, normal.Process, characters: 8) is { Status: "partial", Windows.Count: 1 });
            Check("controlLimit", Observe(own, normal.Process, windows: 1) is { Status: "partial", Windows.Count: 1 });
            Check("allStillRunning", children.All(child => !child.Process.Wait(0)));

            var evidence = new MsiWindowEvidence(request);
            evidence.Publish([observed, blocked], 123, () => false);
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
        File.WriteAllText(Path.Combine(request.WorkingDirectory, "msi-window-contract.json"), JsonSerializer.Serialize(checks));
        return 0;

        void Check(string name, bool passed)
        {
            checks.Add(name, passed);
            if (!passed) throw new InvalidOperationException("msiWindowContractFailed:" + name);
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

    private static InvalidOperationException FirstSampleFailure(MsiWindowSample observed, long elapsedMilliseconds,
        Func<bool> hasExited, Func<WorkspaceMsiMembership> membership)
    {
        bool? childExitedAfterCapture = null;
        try { childExitedAfterCapture = hasExited(); } catch { }
        return new InvalidOperationException("msiWindowContractFailed:titleCaptured:" + JsonSerializer.Serialize(new
        {
            status = observed.Status,
            titleCaptured = observed.Windows.Any(row => row.Role == "title" && row.Text == "SYNTHETIC MSI WINDOW"),
            messageCaptured = observed.Windows.Any(row => row.Role == "message" && MsiWindowObservation.IsApplicationsInUseMessage(row.Text)),
            buttonCaptured = observed.Windows.Any(row => row.Role == "button" && row.Text == "Synthetic cancel"),
            applicationCaptured = observed.Windows.Any(row => row.Role == "application" && row.Text == "SYNTHETIC OWNED APPLICATION"),
            elapsedMilliseconds,
            childExitedAfterCapture,
            membershipAfterCapture = membership().ToString(),
        }));
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
