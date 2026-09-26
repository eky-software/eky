using System.Diagnostics;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record RelaySettlement(bool Settled, string? Failure);

internal sealed class ByteRelay
{
    private readonly Stream source;
    private readonly Stream destination;
    private readonly CancellationToken cancellation;
    private readonly bool closeDestination;
    private readonly Func<TimeSpan> elapsed;
    private readonly SemaphoreSlim writeGate = new(1, 1);
    private readonly TaskCompletionSource<string> failed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Task pendingWrite = Task.CompletedTask;
    private readonly Task settlement;
    private string? failure;
    private bool detached;

    internal ByteRelay(Stream source, Stream destination, CancellationToken cancellation,
        bool closeDestination = false, Func<TimeSpan>? elapsed = null)
    {
        this.source = source;
        this.destination = destination;
        this.cancellation = cancellation;
        this.closeDestination = closeDestination;
        var clock = Stopwatch.StartNew();
        this.elapsed = elapsed ?? (() => clock.Elapsed);
        Completion = RunAsync();
        settlement = SettleWorkAsync();
    }

    internal Task Completion { get; }
    internal Task<string> Failed => failed.Task;
    internal string? Failure => Volatile.Read(ref failure);

    private void Fail(string code)
    {
        if (Interlocked.CompareExchange(ref failure, code, null) is null) failed.TrySetResult(code);
    }

    private void Fail(Exception error) => Fail(error is AdapterFailure known ? known.Code :
        error is OperationCanceledException ? "stdioRelayCanceled" : "stdioRelayFailed");

    private async Task RunAsync()
    {
        // No queue: this buffer cannot be reused while its single write is outstanding.
        var bytes = new byte[AdapterProtocol.RelayChunkBytes];
        try
        {
            while (true)
            {
                var count = await source.ReadAsync(bytes, cancellation);
                if (count == 0) return;
                await writeGate.WaitAsync(cancellation);
                try
                {
                    // Only the explicit breakBridge handshake permits draining without forwarding.
                    if (detached) continue;
                    await WriteChunkAsync(bytes.AsMemory(0, count));
                    if (Failure is { } code) throw new AdapterFailure(code);
                }
                finally { writeGate.Release(); }
            }
        }
        catch (Exception error) { Fail(error); }
    }

    private async Task WriteChunkAsync(ReadOnlyMemory<byte> bytes)
    {
        var started = elapsed();
        var writeCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        // Even a synchronous Stream.WriteAsync must not occupy the control loop.
        // The task retains bytes and the sink until the actual write finishes.
        pendingWrite = Task.Run(async () =>
        {
            try
            {
                await destination.WriteAsync(bytes, writeCancellation.Token);
                if (elapsed() - started >= TimeSpan.FromMilliseconds(AdapterProtocol.WriteMilliseconds))
                    Fail("stdioWriteStalled");
            }
            catch (Exception error) { Fail(error); }
        });
        try
        {
            await pendingWrite.WaitAsync(TimeSpan.FromMilliseconds(AdapterProtocol.WriteMilliseconds), cancellation);
            if (elapsed() - started >= TimeSpan.FromMilliseconds(AdapterProtocol.WriteMilliseconds)) Fail("stdioWriteStalled");
        }
        catch (TimeoutException) { Fail("stdioWriteStalled"); writeCancellation.Cancel(); }
        catch (OperationCanceledException) { Fail("stdioRelayCanceled"); writeCancellation.Cancel(); }
        finally
        {
            // Disposal must not race an uncancellable write still using this token.
            _ = pendingWrite.ContinueWith(_ => writeCancellation.Dispose(), CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }
    }

    internal async Task DetachDestinationAsync(CancellationToken token)
    {
        await writeGate.WaitAsync(token);
        try
        {
            if (Failure is { } code) throw new AdapterFailure(code);
            if (!pendingWrite.IsCompleted) throw new AdapterFailure("stdioWriteUnsettled");
            detached = true;
            destination.Dispose();
        }
        catch (Exception error) { Fail(error); throw; }
        finally { writeGate.Release(); }
    }

    private async Task SettleWorkAsync()
    {
        await Completion;
        // The observer captures late exceptions too. A late success never clears the first failure.
        await pendingWrite;
        if (closeDestination)
        {
            try { destination.Dispose(); }
            catch (Exception error) { Fail(error); }
        }
    }

    internal async Task<RelaySettlement> SettleAsync(CancellationToken token)
    {
        try { await settlement.WaitAsync(token); return new(true, Failure); }
        catch (OperationCanceledException) { return new(false, Failure); }
    }

    internal static async Task CopyAsync(Stream source, Stream destination, CancellationToken token)
    {
        var relay = new ByteRelay(source, destination, token);
        await relay.Completion;
        token.ThrowIfCancellationRequested();
        if (relay.Failure is { } code) throw new AdapterFailure(code);
    }
}
