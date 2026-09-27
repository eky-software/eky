using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Contract tests only: synthetic files/state, no Electron, owner, Job or subprocess.
internal static partial class ElectronServiceSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static int checks;
    private static void Check(bool condition) { checks++; if (!condition) throw new AdapterFailure("electronSelfTestFailed"); }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (Exception error) when (error is AdapterFailure or InvalidOperationException or KeyNotFoundException or
            JsonException or IOException or DecoderFallbackException)
        { checks++; return; }
        throw new AdapterFailure("electronSelfTestFailed");
    }
    private static JsonDocument Json(object value) => JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(value));

    internal static async Task<int> RunAsync()
    {
        try
        {
            ElectronServiceConfiguration.RequireGuard();
            TestRequests();
            TestConfiguration();
            TestLayout();
            TestPackage();
            TestSharedStateAndClock();
            await TestSerializationAsync();
            TestPathsAndPublication();
            WriteResult(true);
            return 0;
        }
        catch { WriteResult(false); return 1; }
    }

    private static void WriteResult(bool passed) => Console.WriteLine(JsonSerializer.Serialize(new
    { protocol = ElectronServiceConfiguration.Protocol, schemaVersion = BackendServiceProtocol.Version, kind = "selfTest", passed, checks }));

    private static Dictionary<string, object?> Request(string kind = "launch")
    {
        var value = new Dictionary<string, object?>
        {
            ["protocol"] = ElectronServiceConfiguration.Protocol, ["schemaVersion"] = 1, ["generation"] = Generation,
            ["sequence"] = 1, ["kind"] = kind,
        };
        if (kind == "launch") { value["launchNonce"] = Nonce; value["workDeadlineElapsedMilliseconds"] = 15000; }
        return value;
    }
    private static BackendServiceRequest ParseRequest(JsonElement value, long previous = 0)
        => BackendServiceProtocol.Request(value, Generation, Nonce, previous, ServiceProfile.Electron);

    private static void TestRequests()
    {
        Check(ServiceConfiguration.Protocol(ServiceProfile.Backend) == BackendServiceProtocol.Name);
        Check(ServiceConfiguration.Protocol(ServiceProfile.Vite) == ViteServiceConfiguration.Protocol);
        Check(ServiceConfiguration.Protocol(ServiceProfile.Electron) == ElectronServiceConfiguration.Protocol);
        Reject(() => ServiceConfiguration.Protocol((ServiceProfile)int.MaxValue));
        Check(AdapterProtocol.WorkMilliseconds == 20000 && BackendServiceProtocol.CleanupMilliseconds == 3000);
        foreach (var kind in new[] { "launch", "status", "rss", "stop" })
        {
            var values = Request(kind);
            using var frame = Json(values);
            Check(ParseRequest(frame.RootElement) == new BackendServiceRequest(1, kind, kind == "launch" ? 15000 : null));
            Reject(() => ParseRequest(frame.RootElement, 1));
            foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite })
            {
                Reject(() => BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, 0, profile));
                values["protocol"] = ServiceConfiguration.Protocol(profile);
                using var other = Json(values);
                Reject(() => ParseRequest(other.RootElement));
                Check(BackendServiceProtocol.Request(other.RootElement, Generation, Nonce, 0, profile).Kind == kind);
            }
        }
        foreach (var kind in new[] { "exec", "restart", "started", "breakBridge", "" })
        { using var frame = Json(Request(kind)); Reject(() => ParseRequest(frame.RootElement)); }
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
            value => value["args"] = new[] { "--no-sandbox" }, value => value["environment"] = new { EKY_E2E = "1" },
        })
        {
            var values = Request(); change(values);
            using var frame = Json(values); Reject(() => ParseRequest(frame.RootElement));
        }
        foreach (var kind in new[] { "status", "rss", "stop" })
        foreach (var key in new[] { "launchNonce", "workDeadlineElapsedMilliseconds" })
        {
            var values = Request(kind); values[key] = key == "launchNonce" ? Nonce : 15000;
            using var frame = Json(values); Reject(() => ParseRequest(frame.RootElement));
        }
        using var duplicate = JsonDocument.Parse(JsonSerializer.Serialize(Request()).Replace("\"sequence\":1", "\"sequence\":1,\"sequence\":1"));
        Reject(() => ParseRequest(duplicate.RootElement));
    }

    private static BackendServiceState Exited(int code)
    {
        var state = new BackendServiceState();
        state.AdmitLaunch(); state.MarkCreated(); state.Identify(new(7, "0000000000000001"));
        state.Assigned(); state.MarkStarted(); state.SettleCreation(); state.ObserveRoot(true, code); state.ObserveJob(1);
        return state;
    }

    private static void TestSharedStateAndClock()
    {
        foreach (var budget in new[] { 15000, 30000 })
        {
            long now = 400;
            var clock = new BackendServiceClock(budget, () => now);
            var sample = clock.ReadTiming();
            now = 500;
            var target = sample.ElapsedMilliseconds + budget - 1000;
            clock.LatchWorkDeadline(target);
            Check(clock.RemainingWork == budget - 1100);
            Reject(() => clock.LatchWorkDeadline(budget));
            now = target; Reject(clock.RequireWork);
            clock.BeginStop(); now += 1000; clock.BeginStop();
            Check(clock.CleanupStarted == target && clock.RemainingCleanup == 2000);
            now += 2000; Reject(clock.RequireCleanup);
            Reject(() => new BackendServiceClock(budget, () => budget).LatchWorkDeadline(budget));
        }
        foreach (var code in new[] { 0, 1 })
        {
            var state = Exited(code);
            var early = state.Snapshot();
            Check(early is { Started: true, Workload: "exited", FirstFailure: null, Cleanup: "pending" } && early.ExitCode == code);
            Check(!state.CanProveAbsent);
            state.BeginStop(); state.SetStdioSettled(true);
            Check(!state.CanProveAbsent);
            state.ObserveJob(0);
            var terminal = state.Freeze(true);
            Check(terminal.Cleanup == "processTreeAbsent" && terminal.ExitCode == code && terminal.FirstFailure is null);
            Check(ReferenceEquals(terminal, state.Freeze(false)));
            Reject(state.AdmitLaunch);
        }
        var failed = Exited(1);
        failed.Fail("stdioFailed"); failed.Fail("observationLost"); failed.BeginStop();
        failed.ObserveJob(0); failed.SetStdioSettled(true);
        Check(failed.Freeze(true) is { ExitCode: 1, Cleanup: "processTreeAbsent", FirstFailure: "stdioFailed" });
        var unsettled = Exited(1); unsettled.BeginStop(); unsettled.ObserveJob(0);
        Check(unsettled.Freeze(true).Cleanup == "cleanupUnverified");
    }

    private static async Task TestSerializationAsync()
    {
        var state = Exited(1);
        var reply = new BackendServiceReply(ElectronServiceConfiguration.Protocol, 1, Generation, 1, 1, "started",
            state.Snapshot(), null, 2000, null, null);
        var bytes = ControlFrame.Encode(reply);
        using var source = new MemoryStream(bytes);
        using var frame = await ControlFrame.ReadAsync(source, CancellationToken.None);
        BackendServiceProtocol.Identity(frame!.RootElement, Generation, ServiceProfile.Electron);
        Check(frame.RootElement.GetProperty("state").GetProperty("exitCode").GetInt32() == 1 && source.Position == source.Length);
        foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite })
        {
            var other = reply with { Protocol = ServiceConfiguration.Protocol(profile) };
            Check(Encoding.UTF8.GetString(bytes) == Encoding.UTF8.GetString(ControlFrame.Encode(other))
                .Replace(ServiceConfiguration.Protocol(profile), ElectronServiceConfiguration.Protocol, StringComparison.Ordinal));
        }
        state.BeginStop(); state.ObserveJob(0); state.SetStdioSettled(true);
        var terminal = reply with { Sequence = 2, Kind = "terminal", State = state.Freeze(true),
            CleanupStartedElapsedMilliseconds = 2000, RemainingCleanupMilliseconds = 3000 };
        using var parsed = JsonDocument.Parse(ControlFrame.Encode(terminal).AsMemory(0, ControlFrame.Encode(terminal).Length - 1));
        AdapterProtocol.ExactKeys(parsed.RootElement, "protocol", "schemaVersion", "generation", "sequence", "replyTo", "kind",
            "state", "rssBytes", "elapsedMilliseconds", "cleanupStartedElapsedMilliseconds", "remainingCleanupMilliseconds");
        Check(!parsed.RootElement.TryGetProperty("environment", out _) && !parsed.RootElement.TryGetProperty("runtimeConfigPath", out _));
    }
}
