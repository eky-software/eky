using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// A closed caller contract for the existing owner. Bridge-to-owner frames are separate.
internal static class ElectronBridgeServiceProtocol
{
    internal const string Name = "eky.e2e.electron-bridge-service";
    internal const string PipePrefix = "eky-e2e-electron-bridge-v1-";
    internal const string ConfigurationFileName = "electron-bridge-service-config.json";
    internal const string TerminalFileName = "electron-bridge-service-terminal.json";

    internal static BackendServiceRequest Request(JsonElement value, string generation, string nonce, long previous)
    {
        try
        {
            var kind = AdapterProtocol.Text(value, "kind", 16);
            long? deadline = null;
            uint? observedPid = null;
            string? registration = null;
            if (kind == "arm")
            {
                AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "sequence", "kind", "launchNonce",
                    "workDeadlineElapsedMilliseconds");
                if (AdapterProtocol.Token(value, "launchNonce") != nonce) Invalid();
                if (!value.GetProperty("workDeadlineElapsedMilliseconds").TryGetInt64(out var bound) ||
                    !BackendServiceProtocol.IsWorkDeadline(bound)) Invalid();
                deadline = bound;
            }
            else if (kind == "register")
            {
                AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "sequence", "kind", "launchNonce",
                    "observedBridgePid");
                if (AdapterProtocol.Token(value, "launchNonce") != nonce) Invalid();
                if (!value.GetProperty("observedBridgePid").TryGetUInt32(out var pid) || pid == 0) Invalid();
                observedPid = pid;
            }
            else if (kind == "go")
            {
                AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "sequence", "kind", "registration");
                registration = AdapterProtocol.Token(value, "registration");
            }
            else
            {
                AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "sequence", "kind");
                if (kind is not ("status" or "rss" or "stop")) Invalid();
            }
            BackendServiceProtocol.Identity(value, generation, ServiceProfile.ElectronBridge);
            if (!value.GetProperty("sequence").TryGetInt64(out var sequence) || previous < 0 ||
                previous >= BackendServiceProtocol.MaximumSequence || sequence != previous + 1) Invalid();
            return new(sequence, kind, deadline, observedPid, registration);
        }
        catch (Exception error) when (error is AdapterFailure or InvalidOperationException or KeyNotFoundException)
        { throw new AdapterFailure("protocolInvalid"); }
    }

    internal static object Reply(BackendServiceReply reply, string? receipt, string? bootstrap = null)
    {
        if (reply.Protocol != Name || reply.SchemaVersion != BackendServiceProtocol.Version) Invalid();
        if ((reply.Kind == "armed") != (bootstrap is not null)) Invalid();
        if (bootstrap is not null)
        {
            if (receipt is not null || reply.State.Created || reply.State.Started || reply.State.CreationCompleted ||
                reply.State.LaunchClosed || reply.State.FirstFailure is not null || reply.State.Cleanup != "pending" ||
                reply.CleanupStartedElapsedMilliseconds is not null) Invalid();
            try { _ = ElectronBridgeBootstrap.Parse(bootstrap, reply.Generation); }
            catch (AdapterFailure) { Invalid(); }
        }
        if (receipt is not null)
        {
            // Capabilities are private status data, never terminal evidence or other replies.
            if (reply.Kind != "status" || reply.State.LaunchClosed || reply.State.FirstFailure is not null ||
                reply.State.Cleanup != "pending" || reply.CleanupStartedElapsedMilliseconds is not null) Invalid();
            try { BridgeRegistrationProtocol.RequireToken(receipt); }
            catch (AdapterFailure) { Invalid(); }
        }
        return new { reply.Protocol, reply.SchemaVersion, reply.Generation, reply.Sequence, reply.ReplyTo, reply.Kind,
            reply.State, reply.RssBytes, reply.ElapsedMilliseconds, reply.CleanupStartedElapsedMilliseconds,
            reply.RemainingCleanupMilliseconds, registration = receipt, bootstrap };
    }

    internal static string OperationalFailure(Exception error) => error is AdapterFailure known
        ? known.Code == "bridgeRegistrationInvalid" ? "launchRejected"
            : known.Code == "bridgeTimingInvalid" ? "protocolInvalid"
            : BridgePeerObservation.IsFailureCode(known.Code) ? "observationLost"
            : BackendServiceProtocol.OperationalFailure(error)
        : BackendServiceProtocol.OperationalFailure(error);

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new AdapterFailure("protocolInvalid");
}
