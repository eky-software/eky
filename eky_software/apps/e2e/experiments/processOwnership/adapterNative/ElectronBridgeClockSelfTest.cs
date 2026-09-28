using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Injected counter and pure schemas only; no OS timing or process-lifecycle proof.
internal static class ElectronBridgeClockSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);

    internal static int RunChecks()
    {
        var checks = 0;
        void Check(bool condition)
        {
            if (!condition) throw new AdapterFailure("electronBridgeSelfTestFailed");
            checks++;
        }
        void Reject(Action action, string code)
        {
            try { action(); }
            catch (AdapterFailure failure) when (failure.Code == code) { checks++; return; }
            throw new AdapterFailure("electronBridgeSelfTestFailed");
        }

        const long origin = 100000;
        const long frequency = 10000;
        long now = origin;
        var qpc = new ElectronBridgeClock(origin, frequency, () => now);
        // Configuration reading and native startup consume the original allowance.
        now += 1250;
        var clock = new BackendServiceClock(10000, qpc);
        Check(clock.ReadTiming().ElapsedMilliseconds == 125 && clock.RemainingWork == 9875);
        Reject(clock.RequireBridgeArmed, "launchRejected");
        Reject(() => clock.ReadBridgeWorkTiming(Generation, Nonce), "launchRejected");
        Reject(() => clock.ReadBridgeDeadlineTimestamp(), "launchRejected");
        Reject(() => clock.ReadBridgeCleanupDeadlineTimestamp(), "ownerFailed");
        clock.LatchWorkDeadline(8000);
        clock.RequireBridgeArmed(); checks++;
        var encoded = clock.ReadBridgeWorkTiming(Generation, Nonce);
        var bootstrap = ElectronBridgeBootstrap.Parse(encoded, Generation, Nonce);
        Check(bootstrap.WorkDeadlineTimestamp == origin + 80000 && bootstrap.Frequency == frequency);
        Check(clock.ReadBridgeDeadlineTimestamp() == bootstrap.WorkDeadlineTimestamp);
        now += 5000;
        Check(clock.ReadBridgeWorkTiming(Generation, Nonce) == encoded);
        Check(clock.RemainingWork == 7375);
        clock.RequireBridgeArmed(); checks++;
        Check(clock.ReadBridgeDeadlineTimestamp() == origin + 80000);
        Reject(() => clock.LatchWorkDeadline(9000), "launchRejected");
        Reject(() => clock.LatchWorkDeadline(8000), "launchRejected");
        Check(clock.ReadBridgeWorkTiming(Generation, Nonce) == encoded);
        Check(bootstrap.RemainingMilliseconds(now, frequency) == 7374);

        now = origin + 20000;
        clock.BeginStop();
        Check(clock.CleanupStarted == 2000);
        var cleanupDeadline = clock.ReadBridgeCleanupDeadlineTimestamp();
        Check(cleanupDeadline == origin + 50000 && cleanupDeadline < bootstrap.WorkDeadlineTimestamp);
        Check(clock.ReadBridgeDeadlineTimestamp() == cleanupDeadline);
        now += 10000;
        clock.BeginStop();
        Check(clock.CleanupStarted == 2000 && clock.RemainingCleanup == 2000);
        Check(clock.ReadBridgeDeadlineTimestamp() == cleanupDeadline);
        Reject(clock.RequireBridgeArmed, "launchRejected");
        Reject(() => clock.ReadBridgeWorkTiming(Generation, Nonce), "launchRejected");
        Reject(() => clock.LatchWorkDeadline(8000), "launchRejected");
        now = cleanupDeadline;
        Reject(() => clock.ReadBridgeDeadlineTimestamp(), "cleanupDeadlineExceeded");

        now = origin;
        var capped = new BackendServiceClock(1000, new ElectronBridgeClock(origin, frequency, () => now));
        capped.LatchWorkDeadline(BackendServiceProtocol.MaximumSequence);
        Check(capped.ReadBridgeDeadlineTimestamp() == origin + 10000);
        now = origin + 10000;
        Reject(capped.RequireBridgeArmed, "workDeadlineExceeded");
        Reject(() => capped.ReadBridgeWorkTiming(Generation, Nonce), "workDeadlineExceeded");
        // The existing cleanup reserve can follow expiry; it never reopens work.
        capped.BeginStop();
        Check(capped.ReadBridgeDeadlineTimestamp() == origin + 40000);
        Reject(capped.RequireBridgeArmed, "launchRejected");

        now = origin + 20000;
        var expired = new BackendServiceClock(1000, new ElectronBridgeClock(origin, frequency, () => now));
        Reject(() => expired.LatchWorkDeadline(900), "workDeadlineExceeded");
        var direct = new BackendServiceClock(1000, () => 0);
        direct.LatchWorkDeadline(800);
        Check(direct.RemainingWork == 800);
        Reject(() => direct.ReadBridgeWorkTiming(Generation, Nonce), "launchRejected");
        direct.BeginStop();
        Reject(() => direct.ReadBridgeDeadlineTimestamp(), "ownerFailed");

        long fractionalNow = 5;
        var fractional = new ElectronBridgeClock(5, 3001, () => fractionalNow);
        Check(fractional.DeadlineTimestamp(1) == 9);
        fractionalNow = 8; Check(fractional.ReadElapsedMilliseconds() == 0);
        fractionalNow = 9; Check(fractional.ReadElapsedMilliseconds() == 1);
        foreach (var frequencyValue in new[] { 1L, 1000, 3001, 10000000, long.MaxValue })
        {
            var counter = new ElectronBridgeClock(0, frequencyValue, () => 0);
            Check(counter.DeadlineTimestamp(1000) == frequencyValue);
        }
        var overflow = new ElectronBridgeClock(long.MaxValue - 1, 1000, () => long.MaxValue - 1);
        Reject(() => overflow.DeadlineTimestamp(2), "ownerFailed");
        Reject(() => overflow.ReadElapsedMilliseconds(), "ownerFailed");
        foreach (var badFrequency in new[] { 0L, -1 })
            Reject(() => _ = new ElectronBridgeClock(0, badFrequency, () => 0), "ownerFailed");
        Reject(() => _ = new ElectronBridgeClock(-1, 1000, () => 0), "ownerFailed");
        now = 100;
        var backwards = new ElectronBridgeClock(100, 1000, () => now);
        now = 110; Check(backwards.ReadElapsedMilliseconds() == 10);
        now = 109; Reject(() => backwards.ReadElapsedMilliseconds(), "ownerFailed");
        now = 111; Reject(() => backwards.ReadElapsedMilliseconds(), "ownerFailed");
        Reject(() => backwards.DeadlineTimestamp(100), "ownerFailed");
        var throwing = new ElectronBridgeClock(0, 1000, () => throw new IOException("synthetic"));
        Reject(() => throwing.ReadElapsedMilliseconds(), "ownerFailed");
        Reject(() => throwing.DeadlineTimestamp(100), "ownerFailed");
        var tooLarge = new ElectronBridgeClock(0, 1, () => long.MaxValue);
        Reject(() => tooLarge.ReadElapsedMilliseconds(), "ownerFailed");

        Check(ElectronBridgeBootstrap.Parse(encoded, Generation, Nonce) == bootstrap);
        Check(encoded.Length <= ElectronBridgeBootstrap.MaximumBytes);
        Check(bootstrap.RemainingMilliseconds(bootstrap.WorkDeadlineTimestamp, frequency) == 0);
        Check(bootstrap.RemainingMilliseconds(bootstrap.WorkDeadlineTimestamp - 1, frequency) == 0);
        Check(bootstrap.RemainingMilliseconds(bootstrap.WorkDeadlineTimestamp + 1, frequency) == 0);
        Reject(() => bootstrap.RemainingMilliseconds(-1, frequency), "bridgeTimingInvalid");
        Reject(() => bootstrap.RemainingMilliseconds(origin, frequency + 1), "bridgeTimingInvalid");
        Reject(() => ElectronBridgeBootstrap.Parse(encoded, Nonce, Nonce), "bridgeTimingInvalid");
        Reject(() => ElectronBridgeBootstrap.Parse(encoded, Generation, Generation), "bridgeTimingInvalid");
        Reject(() => ElectronBridgeBootstrap.Parse(new string(' ', ElectronBridgeBootstrap.MaximumBytes + 1), Generation, Nonce), "bridgeTimingInvalid");
        foreach (var invalid in new[] { "", "{", "[]", "null", "{}" })
            Reject(() => ElectronBridgeBootstrap.Parse(invalid, Generation, Nonce), "bridgeTimingInvalid");

        var fields = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(encoded)!;
        foreach (var key in fields.Keys)
        {
            var missing = new Dictionary<string, JsonElement>(fields); missing.Remove(key);
            Reject(() => ElectronBridgeBootstrap.Parse(JsonSerializer.Serialize(missing), Generation, Nonce), "bridgeTimingInvalid");
            var duplicate = encoded.Insert(encoded.Length - 1, ",\"" + key + "\":" + fields[key].GetRawText());
            Reject(() => ElectronBridgeBootstrap.Parse(duplicate, Generation, Nonce), "bridgeTimingInvalid");
        }
        var extra = new Dictionary<string, JsonElement>(fields) { ["extra"] = JsonSerializer.SerializeToElement(true) };
        Reject(() => ElectronBridgeBootstrap.Parse(JsonSerializer.Serialize(extra), Generation, Nonce), "bridgeTimingInvalid");
        foreach (var key in new[] { "frequency", "workDeadlineTimestamp" })
        foreach (var invalid in new object?[] { null, 1, true, "", "0", "-1", "+1", "01", "1.0", "1e3", " 1", "1\n", "9223372036854775808" })
        {
            var changed = new Dictionary<string, JsonElement>(fields) { [key] = JsonSerializer.SerializeToElement(invalid) };
            Reject(() => ElectronBridgeBootstrap.Parse(JsonSerializer.Serialize(changed), Generation, Nonce), "bridgeTimingInvalid");
        }
        foreach (var (key, value) in new (string, object)[]
        {
            ("protocol", "other"), ("schemaVersion", 2), ("schemaVersion", "1"),
            ("generation", new string('A', 64)), ("launchNonce", new string('B', 64)),
        })
        {
            var changed = new Dictionary<string, JsonElement>(fields) { [key] = JsonSerializer.SerializeToElement(value) };
            Reject(() => ElectronBridgeBootstrap.Parse(JsonSerializer.Serialize(changed), Generation, Nonce), "bridgeTimingInvalid");
        }
        return checks;
    }
}
