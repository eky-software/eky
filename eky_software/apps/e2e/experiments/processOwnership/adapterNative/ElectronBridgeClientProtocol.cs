using System.Globalization;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record ElectronBridgeClientMessage(string Kind, int? ExitCode, long DeadlineTimestamp);

// Private control frames are consumed here, never forwarded to Playwright's streams.
internal static class ElectronBridgeClientProtocol
{
    internal static object Message(string generation, string nonce, string kind, int? exitCode, long deadlineTimestamp)
    {
        BridgeRegistrationProtocol.RequireToken(generation);
        BridgeRegistrationProtocol.RequireToken(nonce);
        RequireValues(kind, exitCode, deadlineTimestamp);
        return new { protocol = BridgeRegistrationProtocol.Name, schemaVersion = BridgeRegistrationProtocol.Version,
            generation, launchNonce = nonce, kind, exitCode,
            deadlineTimestamp = deadlineTimestamp.ToString(CultureInfo.InvariantCulture) };
    }

    internal static ElectronBridgeClientMessage Parse(JsonElement value, string generation, string nonce)
    {
        try
        {
            AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "kind", "exitCode", "deadlineTimestamp");
            AdapterProtocol.Identity(value, generation);
            if (AdapterProtocol.Text(value, "protocol", 64) != BridgeRegistrationProtocol.Name ||
                AdapterProtocol.Token(value, "launchNonce") != nonce) Invalid();
            var kind = AdapterProtocol.Text(value, "kind", 16);
            int? exit = null;
            var code = value.GetProperty("exitCode");
            if (code.ValueKind != JsonValueKind.Null)
            {
                if (!code.TryGetInt32(out var parsed)) Invalid();
                exit = parsed;
            }
            var text = AdapterProtocol.Text(value, "deadlineTimestamp", 19);
            if (!long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var deadline) ||
                text != deadline.ToString(CultureInfo.InvariantCulture)) Invalid();
            RequireValues(kind, exit, deadline);
            return new(kind, exit, deadline);
        }
        catch (Exception error) when (error is AdapterFailure or InvalidOperationException or KeyNotFoundException or ArgumentException)
        { throw new AdapterFailure("protocolInvalid"); }
    }

    private static void RequireValues(string kind, int? exit, long deadline)
    {
        if (kind is not ("started" or "rootExit" or "stopping") ||
            (kind == "rootExit") != exit.HasValue || deadline <= 0) Invalid();
    }

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new AdapterFailure("protocolInvalid");
}

internal sealed class ElectronBridgeClientState
{
    internal bool Started { get; private set; }
    internal bool Stopping { get; private set; }
    internal int? ExitCode { get; private set; }
    internal bool RootExited => ExitCode.HasValue;

    internal void Accept(ElectronBridgeClientMessage message)
    {
        switch (message.Kind)
        {
            case "started" when !Started && !Stopping && !RootExited:
                Started = true;
                break;
            case "stopping" when !Stopping:
                Stopping = true;
                break;
            case "rootExit" when Started && !RootExited:
                ExitCode = message.ExitCode ?? throw new AdapterFailure("protocolInvalid");
                break;
            default:
                throw new AdapterFailure("protocolInvalid");
        }
    }

    internal void RequireExpectedEof()
    {
        if (!RootExited) throw new AdapterFailure("observationLost");
    }
}
