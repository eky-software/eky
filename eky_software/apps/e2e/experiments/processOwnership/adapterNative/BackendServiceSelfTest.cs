using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// This entry point tests contracts only. It never constructs an owner, Job or child process.
internal static partial class BackendServiceSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static int checks;
    private static void Check(bool condition) { checks++; if (!condition) throw new AdapterFailure("backendSelfTestFailed"); }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (Exception error) when (error is AdapterFailure or InvalidOperationException or KeyNotFoundException)
        { checks++; return; }
        throw new AdapterFailure("backendSelfTestFailed");
    }
    private static void RejectCode(Action action, string code)
    {
        try { action(); }
        catch (AdapterFailure error) when (error.Code == code) { checks++; return; }
        throw new AdapterFailure("backendSelfTestFailed");
    }
    private static JsonDocument Json(object value) => JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(value));

    internal static async Task<int> RunAsync()
    {
        try
        {
            BackendServiceConfiguration.RequireGuard();
            TestRequests();
            TestConfiguration();
            TestPaths();
            TestState();
            TestClocks();
            TestWorkDeadlineLatch();
            TestReplyTiming();
            await TestSerializationAsync();
            Console.WriteLine(JsonSerializer.Serialize(new { protocol = BackendServiceProtocol.Name,
                schemaVersion = BackendServiceProtocol.Version, kind = "selfTest", passed = true, checks }));
            return 0;
        }
        catch
        {
            Console.WriteLine(JsonSerializer.Serialize(new { protocol = BackendServiceProtocol.Name,
                schemaVersion = BackendServiceProtocol.Version, kind = "selfTest", passed = false, checks }));
            return 1;
        }
    }

    private static Dictionary<string, object?> Request(string kind, object sequence) => new()
    {
        ["protocol"] = BackendServiceProtocol.Name, ["schemaVersion"] = BackendServiceProtocol.Version,
        ["generation"] = Generation, ["sequence"] = sequence, ["kind"] = kind,
    };

    private static void TestRequests()
    {
        foreach (var kind in new[] { "launch", "status", "rss", "stop" })
        {
            var values = Request(kind, 1);
            if (kind == "launch")
            {
                values["launchNonce"] = Nonce;
                values["workDeadlineElapsedMilliseconds"] = 60000;
            }
            using var frame = Json(values);
            var request = BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0);
            Check(request.Sequence == 1 && request.Kind == kind);
            Check(request.WorkDeadlineElapsedMilliseconds == (kind == "launch" ? 60000L : (long?)null));
            Reject(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 1));
            Reject(() => BackendServiceProtocol.Request(frame.RootElement, Nonce, Nonce, 0));
        }
        foreach (var sequence in new object[] { 0, -1, 2, 1.5, "1", true, 9007199254740992L })
        {
            using var frame = Json(Request("status", sequence));
            Reject(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0));
        }
        foreach (var kind in new[] { "restart", "exec", "breakBridge", "started", "" })
        {
            using var frame = Json(Request(kind, 1));
            Reject(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0));
        }
        foreach (var change in new Action<Dictionary<string, object?>>[]
        {
            value => value["argv"] = new[] { "--eval", "rejected" }, value => value["protocol"] = "eky.t3c",
            value => value["schemaVersion"] = "1", value => value["schemaVersion"] = 2,
            value => value.Remove("generation"), value => value["launchNonce"] = Nonce,
        })
        {
            var values = Request("status", 1);
            change(values);
            using var frame = Json(values);
            Reject(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0));
        }
        var launch = Request("launch", 1);
        launch["workDeadlineElapsedMilliseconds"] = 60000;
        using (var missing = Json(launch)) Reject(() => BackendServiceProtocol.Request(missing.RootElement, Generation, Nonce, 0));
        launch["launchNonce"] = Generation;
        using (var wrong = Json(launch)) Reject(() => BackendServiceProtocol.Request(wrong.RootElement, Generation, Nonce, 0));
        using var duplicate = JsonDocument.Parse(JsonSerializer.Serialize(Request("status", 1)).Replace("\"sequence\":1", "\"sequence\":1,\"sequence\":1"));
        Reject(() => BackendServiceProtocol.Request(duplicate.RootElement, Generation, Nonce, 0));
        using var last = Json(Request("stop", BackendServiceProtocol.MaximumSequence));
        Check(BackendServiceProtocol.Request(last.RootElement, Generation, Nonce, BackendServiceProtocol.MaximumSequence - 1).Kind == "stop");
        Reject(() => BackendServiceProtocol.Request(last.RootElement, Generation, Nonce, BackendServiceProtocol.MaximumSequence));
        TestLaunchWorkDeadlineRequests();
    }

    private static void TestLaunchWorkDeadlineRequests()
    {
        var launch = Request("launch", 1);
        launch["launchNonce"] = Nonce;
        using (var missing = Json(launch))
            RejectCode(() => BackendServiceProtocol.Request(missing.RootElement, Generation, Nonce, 0), "protocolInvalid");
        foreach (var invalid in new object?[] { null, 0, -1, 1.5, "60000", true, new[] { 60000 }, new { value = 60000 },
            BackendServiceProtocol.MaximumSequence + 1, long.MaxValue })
        {
            launch["workDeadlineElapsedMilliseconds"] = invalid;
            using var frame = Json(launch);
            RejectCode(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0), "protocolInvalid");
        }
        foreach (var valid in new[] { 1L, 60000, BackendServiceProtocol.MaximumSequence })
        {
            launch["workDeadlineElapsedMilliseconds"] = valid;
            using var frame = Json(launch);
            Check(BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0).WorkDeadlineElapsedMilliseconds == valid);
        }
        launch["workDeadlineElapsedMilliseconds"] = 60000;
        using (var duplicate = JsonDocument.Parse(JsonSerializer.Serialize(launch).Replace(
            "\"workDeadlineElapsedMilliseconds\":60000", "\"workDeadlineElapsedMilliseconds\":60000,\"workDeadlineElapsedMilliseconds\":60000")))
            RejectCode(() => BackendServiceProtocol.Request(duplicate.RootElement, Generation, Nonce, 0), "protocolInvalid");
        foreach (var kind in new[] { "status", "rss", "stop" })
        {
            var values = Request(kind, 1);
            values["workDeadlineElapsedMilliseconds"] = 60000;
            using var frame = Json(values);
            RejectCode(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0), "protocolInvalid");
        }
    }

    private static Dictionary<string, object?> Configuration() => new()
    {
        ["protocol"] = BackendServiceProtocol.Name, ["schemaVersion"] = BackendServiceProtocol.Version,
        ["generation"] = Generation, ["launchNonce"] = Nonce, ["nodeExecutable"] = @"C:\runtime\node.exe",
        ["repositoryRoot"] = @"C:\source", ["osTempRoot"] = @"C:\temp", ["runRoot"] = @"C:\temp\eky-e2e\run-synthetic",
        ["controlRoot"] = @"C:\temp\eky-e2e\run-synthetic\owner", ["runtimeConfigPath"] = @"C:\temp\eky-e2e\run-synthetic\bootstrap\config.json",
        ["environment"] = new Dictionary<string, string>
        {
            ["EKY_E2E"] = "1", ["NODE_ENV"] = "test", ["SystemRoot"] = @"C:\Windows", ["WINDIR"] = @"C:\Windows",
            ["TEMP"] = @"C:\temp\eky-e2e\run-synthetic\temp", ["TMP"] = @"C:\temp\eky-e2e\run-synthetic\temp",
            ["USERPROFILE"] = @"C:\temp\eky-e2e\run-synthetic\profile", ["APPDATA"] = @"C:\temp\eky-e2e\run-synthetic\roaming",
            ["LOCALAPPDATA"] = @"C:\temp\eky-e2e\run-synthetic\local",
            ["EKY_E2E_OS_TEMP_ROOT"] = @"C:\temp",
        },
        ["workBudgetMilliseconds"] = 60000,
    };

    private static void TestConfiguration()
    {
        using var document = Json(Configuration());
        var config = BackendServiceConfiguration.Parse(document.RootElement);
        Check(config.WorkBudgetMilliseconds == 60000 && config.RuntimeConfigPath.EndsWith(@"bootstrap\config.json", StringComparison.Ordinal));
        Check(config.Entrypoint == @"C:\source\apps\backend\e2e-dist\e2e\backendEntrypoint.js");
        Check(config.PipeName == $"eky-e2e-backend-v1-{Generation}" && !config.Environment.ContainsKey("PATH"));
        foreach (var budget in new object[] { 0, -1, 1.5, "60000", (long)int.MaxValue + 1 })
        {
            var values = Configuration(); values["workBudgetMilliseconds"] = budget;
            using var invalid = Json(values); Reject(() => BackendServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in new[] { "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "EKY_ELECTRON_E2E_RUN_ROOT",
            "SECRET", "PATH", "Path", "path", "eky_e2e_os_temp_root" })
        {
            var values = Configuration(); ((Dictionary<string, string>)values["environment"]!)[key] = "rejected";
            using var invalid = Json(values); Reject(() => BackendServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in new[] { "TEMP", "NODE_ENV", "EKY_E2E", "EKY_E2E_OS_TEMP_ROOT", "USERPROFILE" })
        {
            var values = Configuration(); ((Dictionary<string, string>)values["environment"]!).Remove(key);
            using var invalid = Json(values); Reject(() => BackendServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in new[] { "argv", "command", "cleanupBudgetMilliseconds", "entrypoint" })
        {
            var values = Configuration(); values[key] = "rejected";
            using var invalid = Json(values); Reject(() => BackendServiceConfiguration.Parse(invalid.RootElement));
        }
    }

    private static void TestReplyTiming()
    {
        long now = 0;
        var reads = 0;
        var clock = new BackendServiceClock(60000, () => { reads++; return now; });
        var pending = clock.ReadTiming();
        Check(reads == 1 && pending.ElapsedMilliseconds == 0 &&
            pending.CleanupStartedElapsedMilliseconds is null && pending.RemainingCleanupMilliseconds is null);
        now = 1250; clock.BeginStop();
        now = 1300;
        var stopping = clock.ReadTiming();
        Check(reads == 3 && stopping.ElapsedMilliseconds == 1300 &&
            stopping.CleanupStartedElapsedMilliseconds == 1250 && stopping.RemainingCleanupMilliseconds == 2950);
        now = 1400; clock.BeginStop();
        var repeated = clock.ReadTiming();
        Check(reads == 4 && repeated.ElapsedMilliseconds == 1400 &&
            repeated.CleanupStartedElapsedMilliseconds == 1250 && repeated.RemainingCleanupMilliseconds == 2850);
        Check(clock.ReadTiming() == repeated);
        now = 4250;
        var expired = clock.ReadTiming();
        Check(expired.ElapsedMilliseconds == 4250 && expired.CleanupStartedElapsedMilliseconds == 1250 &&
            expired.RemainingCleanupMilliseconds == 0);
        Reject(clock.RequireCleanup);
        now = 4500; clock.BeginStop();
        Check(clock.ReadTiming().RemainingCleanupMilliseconds == 0 && clock.CleanupStarted == 1250);
        now = 4499; Reject(() => _ = clock.ReadTiming());
        now = 4501; Reject(() => _ = clock.ReadTiming());
        var maximum = BackendServiceProtocol.MaximumSequence - BackendServiceProtocol.CleanupMilliseconds;
        Check(new BackendServiceClock(1, () => maximum).ReadTiming().ElapsedMilliseconds == maximum);
        Reject(() => _ = new BackendServiceClock(1, () => maximum + 1).ReadTiming());
        Reject(() => _ = new BackendServiceClock(1, () => -1).ReadTiming());
    }

    private static async Task TestSerializationAsync()
    {
        var state = Running();
        var dto = new BackendServiceReply(BackendServiceProtocol.Name, 1, Generation, 1, 1, "started", state.Snapshot(), null, 42, null, null);
        var bytes = ControlFrame.Encode(dto);
        var expected = "{\"protocol\":\"eky.e2e.backend-service\",\"schemaVersion\":1,\"generation\":\"" + Generation +
            "\",\"sequence\":1,\"replyTo\":1,\"kind\":\"started\",\"state\":{\"created\":true,\"started\":true," +
            "\"creationCompleted\":true,\"launchClosed\":true,\"identity\":{\"pid\":7,\"creationTimeFileTimeHex\":\"0000000000000001\"}," +
            "\"workload\":\"running\",\"exitCode\":null,\"assignedBeforeResume\":true,\"activeProcesses\":1,\"stdioSettled\":false," +
            "\"firstFailure\":null,\"cleanup\":\"pending\",\"cleanupFailure\":null},\"rssBytes\":null," +
            "\"elapsedMilliseconds\":42,\"cleanupStartedElapsedMilliseconds\":null,\"remainingCleanupMilliseconds\":null}\n";
        Check(Encoding.UTF8.GetString(bytes) == expected && bytes.All(value => value < 128));
        using var source = new MemoryStream(bytes);
        using var frame = await ControlFrame.ReadAsync(source, CancellationToken.None);
        Check(frame!.RootElement.GetProperty("state").GetProperty("creationCompleted").GetBoolean());
        Check(bytes.Length <= AdapterProtocol.FrameBytes && source.Position == source.Length);
        state.BeginStop(); state.ObserveRoot(true, 1); state.ObserveJob(0); state.SetStdioSettled(true);
        var terminal = dto with { Sequence = 2, ReplyTo = null, Kind = "terminal", State = state.Freeze(true),
            ElapsedMilliseconds = 60500, CleanupStartedElapsedMilliseconds = 60000, RemainingCleanupMilliseconds = 2500 };
        using var parsed = JsonDocument.Parse(ControlFrame.Encode(terminal).AsMemory(0, ControlFrame.Encode(terminal).Length - 1));
        Check(parsed.RootElement.GetProperty("replyTo").ValueKind == JsonValueKind.Null &&
            parsed.RootElement.GetProperty("state").GetProperty("cleanup").GetString() == "processTreeAbsent" &&
            parsed.RootElement.GetProperty("elapsedMilliseconds").GetInt64() == 60500);
        var repeated = terminal with { Sequence = 3, ElapsedMilliseconds = 61000, RemainingCleanupMilliseconds = 2000 };
        Check(repeated.ReplyTo is null && ReferenceEquals(repeated.State, terminal.State));
        Check(JsonSerializer.Serialize(repeated.State, AdapterProtocol.Json) == JsonSerializer.Serialize(terminal.State, AdapterProtocol.Json));
    }
}
