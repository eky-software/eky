using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record ElectronBridgeBootstrap(long WorkDeadlineTimestamp, long Frequency)
{
    internal const string Protocol = "eky.e2e.electron-bridge-timing";
    internal const int Version = 1;
    internal const int MaximumBytes = 1024;

    internal string Encode(string generation, string nonce)
    {
        RequireIdentity(generation, nonce);
        if (WorkDeadlineTimestamp <= 0 || Frequency <= 0) Invalid();
        return JsonSerializer.Serialize(new { protocol = Protocol, schemaVersion = Version, generation,
            launchNonce = nonce, frequency = Frequency.ToString(CultureInfo.InvariantCulture),
            workDeadlineTimestamp = WorkDeadlineTimestamp.ToString(CultureInfo.InvariantCulture) });
    }

    internal static ElectronBridgeBootstrap Parse(string value, string generation, string nonce)
    {
        RequireIdentity(generation, nonce);
        return ParseCore(value, generation, nonce);
    }

    internal static ElectronBridgeBootstrap Parse(string value, string generation) => ParseCore(value, generation, null);

    private static ElectronBridgeBootstrap ParseCore(string value, string generation, string? nonce)
    {
        try
        {
            if (value is null || value.Length > MaximumBytes || Encoding.UTF8.GetByteCount(value) > MaximumBytes) Invalid();
            BridgeRegistrationProtocol.RequireToken(generation);
            using var document = JsonDocument.Parse(value, new JsonDocumentOptions { MaxDepth = 2 });
            var frame = document.RootElement;
            AdapterProtocol.ExactKeys(frame, "protocol", "schemaVersion", "generation", "launchNonce", "frequency", "workDeadlineTimestamp");
            if (AdapterProtocol.Text(frame, "protocol", 64) != Protocol ||
                !frame.GetProperty("schemaVersion").TryGetInt32(out var version) || version != Version ||
                AdapterProtocol.Token(frame, "generation") != generation) Invalid();
            var actualNonce = AdapterProtocol.Token(frame, "launchNonce");
            if (nonce is not null && actualNonce != nonce) Invalid();
            return new(PositiveDecimal(frame, "workDeadlineTimestamp"), PositiveDecimal(frame, "frequency"));
        }
        catch (Exception error) when (error is AdapterFailure or JsonException or InvalidOperationException or KeyNotFoundException)
        { throw new AdapterFailure("bridgeTimingInvalid"); }
    }

    internal long RemainingMilliseconds(long timestamp, long frequency)
    {
        if (timestamp < 0 || frequency != Frequency || Frequency <= 0 || WorkDeadlineTimestamp <= 0) Invalid();
        // Cross-process QPC readings within one tick have ambiguous ordering.
        var ticks = (Int128)WorkDeadlineTimestamp - timestamp - 1;
        return ticks <= 0 ? 0 : (long)Int128.Min(int.MaxValue, ticks * 1000 / Frequency);
    }

    private static long PositiveDecimal(JsonElement frame, string key)
    {
        var value = AdapterProtocol.Text(frame, key, 19);
        long result = 0;
        if (value.Length == 0 || value[0] is < '1' or > '9' || value.Any(character => character is < '0' or > '9') ||
            !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out result)) Invalid();
        return result;
    }

    private static void RequireIdentity(string generation, string nonce)
    {
        try { BridgeRegistrationProtocol.RequireToken(generation); BridgeRegistrationProtocol.RequireToken(nonce); }
        catch (AdapterFailure) { Invalid(); }
    }

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new AdapterFailure("bridgeTimingInvalid");
}
