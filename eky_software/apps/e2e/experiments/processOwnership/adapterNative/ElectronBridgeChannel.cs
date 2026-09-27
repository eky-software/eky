using System.IO.Pipes;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// The current service owner owns these pipes. No independent process owner or work clock.
internal sealed class ElectronBridgeChannel : IDisposable
{
    private readonly ElectronServiceConfiguration config;
    private readonly NamedPipeServerStream control;
    private readonly NamedPipeServerStream output;
    private readonly NamedPipeServerStream error;
    private readonly CancellationTokenSource observation = new();
    private BridgePeerObservation? peer;
    private Task<JsonDocument?>? unexpected;
    private bool acquisitionAttempted;
    private string[]? launchArguments;
    private string? observationFailure;

    internal ElectronBridgeChannel(ElectronServiceConfiguration config)
    {
        this.config = config;
        control = LocalControlPipe.Create(config.PipeName + "-control", PipeDirection.InOut);
        try
        {
            output = LocalControlPipe.Create(config.PipeName + "-output", PipeDirection.Out);
            try { error = LocalControlPipe.Create(config.PipeName + "-error", PipeDirection.Out); }
            catch { output.Dispose(); throw; }
        }
        catch { control.Dispose(); throw; }
    }

    internal Stream Output => output;
    internal Stream Error => error;

    internal async Task ConnectAsync(CancellationToken cancellation)
    {
        await Task.WhenAll(control.WaitForConnectionAsync(cancellation), output.WaitForConnectionAsync(cancellation),
            error.WaitForConnectionAsync(cancellation));
        cancellation.ThrowIfCancellationRequested();
        using var hello = await ControlFrame.ReadAsync(control, cancellation) ?? throw new AdapterFailure("bridgeRegistrationInvalid");
        cancellation.ThrowIfCancellationRequested();
        var arguments = ElectronBridgeLaunch.ParseLaunch(hello.RootElement, config);
        cancellation.ThrowIfCancellationRequested();
        launchArguments = arguments;
    }

    internal BridgeRegistrationGate AcquireGate(uint observedPid, Action requireWork)
    {
        if (acquisitionAttempted || launchArguments is null) throw new AdapterFailure("bridgeRegistrationInvalid");
        acquisitionAttempted = true;
        peer = BridgePeerObservation.Acquire(control, output, error, observedPid);
        var identity = peer.Identity;
        return new(config.Generation, config.LaunchNonce, identity.ProcessId, identity.CreationTime,
            RequirePeer, requireWork);
    }

    internal async Task<ElectronBridgeProof> ExchangeAsync(BridgeChallenges challenges, CancellationToken cancellation)
    {
        await BridgeRegistrationExchange.WriteChallengesAsync(control, output, error, config.Generation,
            config.LaunchNonce, challenges, cancellation);
        using var proof = await ControlFrame.ReadAsync(control, cancellation) ?? throw new AdapterFailure("bridgeRegistrationInvalid");
        cancellation.ThrowIfCancellationRequested();
        return new(proof.RootElement.Clone(), launchArguments ?? throw new AdapterFailure("bridgeRegistrationInvalid"));
    }

    internal void BeginPeerObservation()
    {
        if (unexpected is not null) throw new AdapterFailure("bridgeRegistrationInvalid");
        unexpected = ControlFrame.ReadAsync(control, observation.Token);
    }

    internal void RequirePeer()
    {
        RequireNoUnexpectedFrame(false);
        if (peer is null) throw new AdapterFailure("bridgePeerObservationFailed");
        peer.RequireAliveAndBound();
        RequireNoUnexpectedFrame(false);
    }

    internal void RequireNoUnexpectedFrame(bool rootExited) => RequireNoUnexpectedFrame(unexpected, rootExited);

    internal static void RequireNoUnexpectedFrame(Task<JsonDocument?>? unexpected, bool rootExited)
    {
        if (ObservationFailure(unexpected, rootExited) is { } failure) throw new AdapterFailure(failure);
    }

    internal static string? ObservationFailure(Task<JsonDocument?>? unexpected, bool rootExited,
        CancellationToken expectedCancellation = default)
    {
        if (unexpected?.IsCompleted != true) return null;
        JsonDocument? frame;
        try { frame = unexpected.GetAwaiter().GetResult(); }
        catch (OperationCanceledException canceled) when (expectedCancellation.IsCancellationRequested &&
            canceled.CancellationToken == expectedCancellation) { return null; }
        catch { return "protocolInvalid"; }
        if (frame is not null) return "protocolInvalid";
        return rootExited ? null : "bridgePeerObservationFailed";
    }

    internal Task SendAsync(string kind, int? exitCode, CancellationToken cancellation) =>
        ControlFrame.WriteAsync(control, new { protocol = BridgeRegistrationProtocol.Name,
            schemaVersion = BridgeRegistrationProtocol.Version, generation = config.Generation,
            launchNonce = config.LaunchNonce, kind, exitCode }, cancellation);

    internal string? StopObservation(bool rootExited)
    {
        // A completed fault/EOF preceding our cancellation remains a workload failure.
        observationFailure ??= ObservationFailure(unexpected, rootExited);
        observation.Cancel();
        return observationFailure;
    }

    internal void ClosePipes() { control.Dispose(); output.Dispose(); error.Dispose(); }
    internal void CloseOutput() => output.Dispose();
    internal void CloseError() => error.Dispose();

    internal async Task<(bool Settled, string? Failure)> SettleObservationAsync(bool rootExited, CancellationToken cancellation)
    {
        if (unexpected is null) return (true, observationFailure);
        try { await unexpected.WaitAsync(cancellation); }
        catch { /* Classify the actual observation below, independently of the cleanup wait. */ }
        observationFailure ??= ObservationFailure(unexpected, rootExited, observation.Token);
        return (unexpected.IsCompleted && !cancellation.IsCancellationRequested, observationFailure);
    }

    public void Dispose()
    {
        observation.Cancel();
        ClosePipes(); peer?.Dispose();
        var pending = unexpected;
        if (pending is null) { observation.Dispose(); return; }
        _ = pending.ContinueWith(completed =>
        {
            if (completed.IsCompletedSuccessfully) completed.Result?.Dispose();
            else _ = completed.Exception;
            observation.Dispose();
        }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }
}
