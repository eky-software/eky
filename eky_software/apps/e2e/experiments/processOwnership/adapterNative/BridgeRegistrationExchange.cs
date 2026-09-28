namespace Eky.ProcessOwnershipAdapter;

internal static class BridgeRegistrationExchange
{
    // The owning session supplies its original cancellation/deadline. These methods do not start a new work budget.
    internal static async Task WriteChallengesAsync(Stream control, Stream output, Stream error,
        string generation, string nonce, BridgeChallenges values, CancellationToken cancellation)
    {
        BridgeRegistrationProtocol.RequireChallenges(values);
        await ControlFrame.WriteAsync(control, BridgeRegistrationProtocol.Challenge(generation, nonce, "control", values.Control), cancellation);
        cancellation.ThrowIfCancellationRequested();
        await ControlFrame.WriteAsync(output, BridgeRegistrationProtocol.Challenge(generation, nonce, "output", values.Output), cancellation);
        cancellation.ThrowIfCancellationRequested();
        await ControlFrame.WriteAsync(error, BridgeRegistrationProtocol.Challenge(generation, nonce, "error", values.Error), cancellation);
        cancellation.ThrowIfCancellationRequested();
    }

    internal static async Task<BridgeChallenges> ReadChallengesAsync(Stream control, Stream output, Stream error,
        string generation, string nonce, CancellationToken cancellation)
    {
        async Task<string> ReadAsync(Stream stream, string role)
        {
            using var frame = await ControlFrame.ReadAsync(stream, cancellation) ?? throw new AdapterFailure("bridgeRegistrationInvalid");
            cancellation.ThrowIfCancellationRequested();
            return BridgeRegistrationProtocol.ReadChallenge(frame.RootElement, generation, nonce, role);
        }
        // Consume exactly the first bounded frame per pipe before any raw byte relay exists.
        var values = new BridgeChallenges(await ReadAsync(control, "control"), await ReadAsync(output, "output"),
            await ReadAsync(error, "error"));
        BridgeRegistrationProtocol.RequireChallenges(values);
        cancellation.ThrowIfCancellationRequested();
        return values;
    }
}
