using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Contract tests only: no owner, Job, Vite, child process or network listener is started.
internal static partial class ViteServiceSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static int checks;
    private static void Check(bool condition) { checks++; if (!condition) throw new AdapterFailure("viteSelfTestFailed"); }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (Exception error) when (error is AdapterFailure or InvalidOperationException or KeyNotFoundException or JsonException)
        { checks++; return; }
        throw new AdapterFailure("viteSelfTestFailed");
    }
    private static JsonDocument Json(object value) => JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(value));

    internal static async Task<int> RunAsync()
    {
        try
        {
            ViteServiceConfiguration.RequireGuard();
            TestRequests();
            TestConfiguration();
            TestLayout();
            TestEnvironmentRootPaths();
            TestPackage();
            TestSharedStateAndClock();
            await TestSerializationAsync();
            TestTerminalPublication();
            WriteResult(true);
            return 0;
        }
        catch
        {
            WriteResult(false);
            return 1;
        }
    }

    private static void WriteResult(bool passed) => Console.WriteLine(JsonSerializer.Serialize(new
    { protocol = ViteServiceConfiguration.Protocol, schemaVersion = BackendServiceProtocol.Version, kind = "selfTest", passed, checks }));

    private static Dictionary<string, object?> Request(string kind = "launch")
    {
        var value = new Dictionary<string, object?>
        {
            ["protocol"] = ViteServiceConfiguration.Protocol, ["schemaVersion"] = 1, ["generation"] = Generation,
            ["sequence"] = 1, ["kind"] = kind,
        };
        if (kind == "launch") { value["launchNonce"] = Nonce; value["workDeadlineElapsedMilliseconds"] = 15000; }
        return value;
    }

    private static BackendServiceRequest ParseRequest(JsonElement value, long previous = 0)
        => BackendServiceProtocol.Request(value, Generation, Nonce, previous, ServiceProfile.Vite);

    private static void TestRequests()
    {
        Check(ServiceConfiguration.Protocol(ServiceProfile.Backend) == BackendServiceProtocol.Name);
        Check(ServiceConfiguration.Protocol(ServiceProfile.Vite) == ViteServiceConfiguration.Protocol);
        Reject(() => ServiceConfiguration.Protocol((ServiceProfile)2));
        foreach (var kind in new[] { "launch", "status", "rss", "stop" })
        {
            var values = Request(kind);
            using var frame = Json(values);
            Check(ParseRequest(frame.RootElement) == new BackendServiceRequest(1, kind, kind == "launch" ? 15000 : null));
            Reject(() => ParseRequest(frame.RootElement, 1));
            Reject(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0));
            values["protocol"] = BackendServiceProtocol.Name;
            using var backend = Json(values);
            Reject(() => ParseRequest(backend.RootElement));
            Check(BackendServiceProtocol.Request(backend.RootElement, Generation, Nonce, 0).Kind == kind);
        }
        foreach (var kind in new[] { "exec", "restart", "started", "breakBridge", "" })
        {
            using var frame = Json(Request(kind)); Reject(() => ParseRequest(frame.RootElement));
        }
        foreach (var invalid in new object?[] { null, 0, -1, 1.5, "15000", true, new[] { 15000 }, BackendServiceProtocol.MaximumSequence + 1 })
        {
            var values = Request(); values["workDeadlineElapsedMilliseconds"] = invalid;
            using var frame = Json(values); Reject(() => ParseRequest(frame.RootElement));
        }
        foreach (var change in new Action<Dictionary<string, object?>>[]
        {
            value => value.Remove("workDeadlineElapsedMilliseconds"), value => value.Remove("launchNonce"),
            value => value["launchNonce"] = Generation, value => value["generation"] = Nonce,
            value => value["schemaVersion"] = 2, value => value["schemaVersion"] = "1",
            value => value["protocol"] = "eky.t3c", value => value["sequence"] = 2, value => value["sequence"] = "1",
            value => value["argv"] = new[] { "--eval", "rejected" }, value => value["runtimeSession"] = "rejected",
        })
        {
            var values = Request(); change(values);
            using var frame = Json(values); Reject(() => ParseRequest(frame.RootElement));
        }
        foreach (var kind in new[] { "status", "rss", "stop" })
        {
            var values = Request(kind); values["workDeadlineElapsedMilliseconds"] = 15000;
            using var frame = Json(values); Reject(() => ParseRequest(frame.RootElement));
        }
        using var duplicate = JsonDocument.Parse(JsonSerializer.Serialize(Request()).Replace("\"sequence\":1", "\"sequence\":1,\"sequence\":1"));
        Reject(() => ParseRequest(duplicate.RootElement));
        var last = Request("stop"); last["sequence"] = BackendServiceProtocol.MaximumSequence;
        using var lastFrame = Json(last);
        Check(ParseRequest(lastFrame.RootElement, BackendServiceProtocol.MaximumSequence - 1).Kind == "stop");
        Reject(() => ParseRequest(lastFrame.RootElement, BackendServiceProtocol.MaximumSequence));
    }

    private static void TestSharedStateAndClock()
    {
        long now = 2000;
        var clock = new BackendServiceClock(60000, () => now);
        var sample = clock.ReadTiming();
        Check(sample.ElapsedMilliseconds == 2000 && sample.CleanupStartedElapsedMilliseconds is null);
        now = 2500;
        clock.LatchWorkDeadline(sample.ElapsedMilliseconds + 14000);
        Check(clock.RemainingWork == 13500);
        Reject(() => clock.LatchWorkDeadline(60000));
        now = 16000;
        Reject(clock.RequireWork);
        clock.BeginStop();
        now = 17000; clock.BeginStop();
        Check(clock.CleanupStarted == 16000 && clock.RemainingCleanup == 2000);
        now = 19000; Reject(clock.RequireCleanup);
        var stale = new BackendServiceClock(60000, () => 10000);
        Reject(() => stale.LatchWorkDeadline(10000));
        Check(stale.RemainingWork == 0);

        var state = new BackendServiceState();
        state.AdmitLaunch(); state.MarkCreated(); state.Identify(new(7, "0000000000000001"));
        Reject(state.MarkStarted);
        state.Assigned(); state.MarkStarted(); state.SettleCreation(); state.ObserveJob(1);
        Check(state.Workload == "running" && state.Identity!.Pid == 7);
        state.Fail("stdioFailed"); state.Fail("observationLost"); state.BeginStop();
        Reject(state.AdmitLaunch);
        state.ObserveRoot(true, 0); state.ObserveJob(0);
        Check(!state.CanProveAbsent);
        state.SetStdioSettled(true);
        var terminal = state.Freeze(true);
        Check(terminal.Cleanup == "processTreeAbsent" && terminal.FirstFailure == "stdioFailed");
        Check(ReferenceEquals(terminal, state.Freeze(false)));
        Reject(() => state.Fail("ownerFailed"));
    }

    private static async Task TestSerializationAsync()
    {
        var state = new BackendServiceState();
        var backend = new BackendServiceReply(BackendServiceProtocol.Name, 1, Generation, 1, 1, "status",
            state.Snapshot(), null, 2000, null, null);
        var vite = backend with { Protocol = ViteServiceConfiguration.Protocol };
        var bytes = ControlFrame.Encode(vite);
        Check(Encoding.UTF8.GetString(bytes) == Encoding.UTF8.GetString(ControlFrame.Encode(backend))
            .Replace(BackendServiceProtocol.Name, ViteServiceConfiguration.Protocol, StringComparison.Ordinal));
        Check(bytes.Length <= AdapterProtocol.FrameBytes && bytes.All(value => value < 128));
        using var source = new MemoryStream(bytes);
        using var frame = await ControlFrame.ReadAsync(source, CancellationToken.None);
        BackendServiceProtocol.Identity(frame!.RootElement, Generation, ServiceProfile.Vite);
        Check(source.Position == source.Length && frame.RootElement.GetProperty("state").GetProperty("workload").GetString() == "pending");
        state.BeginStop(); state.ObserveJob(0); state.SetStdioSettled(true);
        var terminal = vite with { Sequence = 2, ReplyTo = null, Kind = "terminal", State = state.Freeze(true),
            ElapsedMilliseconds = 16000, CleanupStartedElapsedMilliseconds = 15000, RemainingCleanupMilliseconds = 2000 };
        var repeated = terminal with { Sequence = 3, ElapsedMilliseconds = 16500, RemainingCleanupMilliseconds = 1500 };
        Check(ReferenceEquals(terminal.State, repeated.State) && repeated.State.Cleanup == "processTreeAbsent");
        using var parsed = JsonDocument.Parse(ControlFrame.Encode(terminal).AsMemory(0, ControlFrame.Encode(terminal).Length - 1));
        AdapterProtocol.ExactKeys(parsed.RootElement, "protocol", "schemaVersion", "generation", "sequence", "replyTo", "kind",
            "state", "rssBytes", "elapsedMilliseconds", "cleanupStartedElapsedMilliseconds", "remainingCleanupMilliseconds");
        Check(!parsed.RootElement.TryGetProperty("environment", out _) && !parsed.RootElement.TryGetProperty("runtimeSession", out _));
    }
}
