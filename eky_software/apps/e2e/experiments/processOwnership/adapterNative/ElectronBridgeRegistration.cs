using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record ElectronBridgeProof(JsonElement Proof, string[] Arguments);

// Only Advance/AdmitGo/Stop on the owner's loop may grant or revoke launch authority.
// Transport continuations return data; they cannot accept a registration or create a process.
internal sealed class ElectronBridgeRegistration(
    Func<CancellationToken, Task> connect,
    Func<uint, BridgeRegistrationGate> acquireGate,
    Func<BridgeChallenges, CancellationToken, Task<ElectronBridgeProof>> exchange,
    Action requireWork) : IDisposable
{
    private readonly CancellationTokenSource cancellation = new();
    private Task? connection;
    private Task<ElectronBridgeProof>? proof;
    private BridgeRegistrationGate? gate;
    private uint observedPid;
    private bool stopped;
    private bool begun;
    private bool admitted;
    private string[]? arguments;
    private string? transportFailure;
    internal string? Receipt { get; private set; }
    internal string? Failure => transportFailure;

    internal void Begin(uint pid)
    {
        if (begun || stopped || pid == 0) throw new AdapterFailure("bridgeRegistrationInvalid");
        requireWork();
        begun = true;
        observedPid = pid;
        connection = connect(cancellation.Token);
    }

    internal void Advance()
    {
        if (stopped || !begun || Receipt is not null) return;
        requireWork();
        if (gate is null && connection!.IsCompleted)
        {
            connection.GetAwaiter().GetResult();
            RequireOpen();
            gate = acquireGate(observedPid);
            RequireOpen();
            var challenges = gate.BeginChallenges();
            RequireOpen();
            proof = exchange(challenges, cancellation.Token);
        }
        if (proof?.IsCompleted == true)
        {
            var value = proof.GetAwaiter().GetResult();
            RequireOpen();
            var receipt = gate!.AcceptProof(value.Proof);
            RequireOpen();
            arguments = (string[])value.Arguments.Clone();
            Receipt = receipt;
        }
    }

    internal string[] AdmitGo(string receipt)
    {
        RequireOpen();
        if (admitted || Receipt is null || arguments is null) throw new AdapterFailure("bridgeRegistrationInvalid");
        gate!.AdmitGo(receipt);
        RequireOpen();
        admitted = true;
        return (string[])arguments.Clone();
    }

    internal void RequireBeforeCreateOrResume()
    {
        RequireOpen();
        if (!admitted) throw new AdapterFailure("bridgeRegistrationInvalid");
        gate!.RequireBeforeCreateOrResume();
        RequireOpen();
    }

    internal void Stop()
    {
        if (stopped) return;
        stopped = true;
        Receipt = null;
        gate?.Stop();
        CaptureTransportFailures(false);
        cancellation.Cancel();
    }

    internal async Task<(bool Settled, string? Failure)> SettleAsync(CancellationToken cleanup)
    {
        if (!stopped) throw new AdapterFailure("bridgeRegistrationInvalid");
        var tasks = new[] { connection, proof }.Where(task => task is not null).Select(task => task!).ToArray();
        var settlement = Task.WhenAll(tasks);
        try { await settlement.WaitAsync(cleanup); }
        catch { /* Classify each actual transport outcome separately from the cleanup wait. */ }
        CaptureTransportFailures(true);
        return (settlement.IsCompleted && !cleanup.IsCancellationRequested, transportFailure);
    }

    private void CaptureTransportFailures(bool allowOwnCancellation)
    {
        Capture(connection);
        Capture(proof);

        void Capture(Task? task)
        {
            if (task?.IsCompleted != true) return;
            if (task.IsFaulted)
            {
                // WhenAll may contain more than the exception surfaced by await.
                foreach (var error in task.Exception!.Flatten().InnerExceptions) Record(error);
            }
            else if (task.IsCanceled)
            {
                try { task.GetAwaiter().GetResult(); }
                catch (Exception error) { Record(error); }
            }
        }

        void Record(Exception error)
        {
            if (allowOwnCancellation && cancellation.IsCancellationRequested &&
                error is OperationCanceledException canceled && canceled.CancellationToken == cancellation.Token) return;
            transportFailure ??= ElectronBridgeServiceProtocol.OperationalFailure(error);
        }
    }

    private void RequireOpen()
    {
        if (stopped) throw new AdapterFailure("bridgeRegistrationInvalid");
        requireWork();
        if (stopped) throw new AdapterFailure("bridgeRegistrationInvalid");
    }

    public void Dispose()
    {
        Stop();
        // Observe late faults without running state transitions or granting launch authority.
        var settlement = Task.WhenAll(new[] { connection, proof }.Where(task => task is not null).Select(task => task!));
        _ = settlement.ContinueWith(completed =>
        {
            _ = completed.Exception;
            cancellation.Dispose();
        }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }
}
