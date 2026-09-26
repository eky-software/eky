namespace Eky.ProcessOwnershipAdapter;

internal static partial class AdapterSelfTest
{
    private static AdapterState Stopped()
    {
        var state = Started();
        state.BeginStop();
        state.Observe(true, 0, 0);
        return state;
    }

    private static async Task<ByteRelay> FailedRelayAsync()
    {
        var source = new MemoryStream([1]);
        var sink = new ControlledWriteStream();
        var relay = new ByteRelay(source, sink, CancellationToken.None);
        await sink.Entered.Task;
        sink.Release.SetException(new IOException("synthetic private text"));
        var result = await relay.SettleAsync(CancellationToken.None);
        Check(result.Settled && result.Failure == "stdioRelayFailed");
        source.Dispose(); sink.Dispose();
        return relay;
    }

    private static async Task TestRelayFinalizationAsync()
    {
        // Stop wins the event-loop race, but finalization still captures the older relay fault.
        var failed = await FailedRelayAsync();
        var state = Stopped();
        Check(state.Failure is null);
        Check(await RelayFinalization.FinishAsync(state, CancellationToken.None, failed));
        Check(state.Cleanup == "processTreeAbsent" && state.Failure == "stdioRelayFailed");
        var terminal = state.Snapshot();
        state.BeginStop();
        Check(await RelayFinalization.FinishAsync(state, CancellationToken.None, failed));
        Check(state.Snapshot() == terminal);

        // A later bridge close, including an intentional break, cannot suppress existing I/O failure.
        var broken = Started(); broken.Observe(false, null, 1); broken.BreakBridge(); broken.LoseBridge();
        broken.BeginStop(); broken.Observe(true, 1, 0);
        Check(await RelayFinalization.FinishAsync(broken, CancellationToken.None, failed));
        Check(broken.BridgeLost && broken.Failure == "stdioRelayFailed");

        using var source = new MemoryStream([4]);
        using var sink = new ControlledWriteStream();
        var concurrent = new ByteRelay(source, sink, CancellationToken.None);
        await sink.Entered.Task;
        var cleaning = Stopped();
        var finish = RelayFinalization.FinishAsync(cleaning, CancellationToken.None, concurrent);
        Check(!finish.IsCompleted && cleaning.Cleanup == "pending");
        sink.Release.SetException(new IOException("fault during cleanup"));
        Check(await finish);
        Check(cleaning.Failure == "stdioRelayFailed");

        // Test-only detachment waits for the real write before closing the forwarding endpoint.
        using var read = new ControlledReadStream();
        using var destination = new ControlledWriteStream();
        var detached = new ByteRelay(read, destination, CancellationToken.None);
        read.Next.SetResult(new byte[] { 7, 8 });
        await destination.Entered.Task;
        var detach = detached.DetachDestinationAsync(CancellationToken.None);
        Check(!detach.IsCompleted && !destination.WasDisposed);
        destination.Release.SetResult();
        await detach;
        Check(destination.WasDisposed);
        await read.ReadAgain.Task;
        read.Tail.SetResult(new byte[] { 9 });
        var expected = Started(); expected.Observe(false, null, 1); expected.BreakBridge(); expected.LoseBridge();
        expected.BeginStop(); expected.Observe(true, 1, 0);
        Check(await RelayFinalization.FinishAsync(expected, CancellationToken.None, detached));
        Check(expected.BridgeLost && expected.Failure is null && destination.Writes == 1);
        await RejectAsync(() => failed.DetachDestinationAsync(CancellationToken.None));

        // A pending control read must not hide a broken relay, even with no further owner messages.
        using var empty = new MemoryStream();
        using var unused = new MemoryStream();
        var quiet = new ByteRelay(empty, unused, CancellationToken.None);
        var pendingControl = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        await RejectAsync(() => RelayFinalization.ControlOrFailureAsync(pendingControl.Task, failed, quiet, CancellationToken.None));
        Check(!pendingControl.Task.IsCompleted);
        await RejectAsync(() => RelayFinalization.ControlOrFailureAsync(Task.FromResult(41), failed, quiet, CancellationToken.None));
        Check(await RelayFinalization.ControlOrFailureAsync(Task.FromResult(41), quiet, quiet, CancellationToken.None) == 41);

        using var futureSource = new MemoryStream([2]);
        using var futureSink = new ControlledWriteStream();
        var futureFailure = new ByteRelay(futureSource, futureSink, CancellationToken.None);
        await futureSink.Entered.Task;
        var readControl = RelayFinalization.ControlOrFailureAsync(pendingControl.Task, quiet, futureFailure, CancellationToken.None);
        Check(!readControl.IsCompleted);
        futureSink.Release.SetException(new IOException("failure while awaiting control"));
        await RejectAsync(() => readControl);
        Check(!pendingControl.Task.IsCompleted);
        Check((await futureFailure.SettleAsync(CancellationToken.None)).Failure == "stdioRelayFailed");
    }

    private static async Task TestStrictWriteAsync()
    {
        foreach (var error in new[] { 109, 232, 233 })
        {
            try { WindowsStandardPipeSink.ValidateWrite(false, error, 0, 1); throw new Exception("selfTestFailed"); }
            catch (AdapterFailure failure) { Check(failure.Code == "stdioBrokenPipe"); }
        }
        Reject(() => WindowsStandardPipeSink.ValidateWrite(false, 5, 0, 1));
        foreach (var written in new uint[] { 0, 1, 3 })
            Reject(() => WindowsStandardPipeSink.ValidateWrite(true, 0, written, 2));
        WindowsStandardPipeSink.ValidateWrite(true, 0, 2, 2); checks++;
        Reject(() => WindowsStandardPipeSink.ValidateWrite(true, 0, 0, 0));

        // A cancellation-ignoring write must fail at the independent deadline, not its eventual return.
        foreach (var lateError in new[] { false, true })
        {
            var bytes = Enumerable.Range(0, AdapterProtocol.RelayChunkBytes + 1).Select(index => (byte)index).ToArray();
            using var source = new MemoryStream(bytes);
            using var sink = new ControlledWriteStream(synchronous: !lateError);
            var relay = new ByteRelay(source, sink, CancellationToken.None);
            var held = await sink.Entered.Task;
            await relay.Completion.WaitAsync(TimeSpan.FromSeconds(3));
            Check(relay.Failure == "stdioWriteStalled" && sink.Writes == 1);
            Check(held.Span.SequenceEqual(bytes.AsSpan(0, AdapterProtocol.RelayChunkBytes)));
            using var expired = new CancellationTokenSource(); expired.Cancel();
            var stopped = Stopped();
            Check(!await RelayFinalization.FinishAsync(stopped, expired.Token, relay));
            Check(stopped.Cleanup == "cleanupUnverified" && stopped.Failure == "stdioWriteStalled");
            if (lateError) sink.Release.SetException(new IOException("late failure"));
            else sink.Release.SetResult();
            var final = await relay.SettleAsync(CancellationToken.None);
            Check(final.Settled && final.Failure == "stdioWriteStalled" && sink.Writes == 1);
        }

        // Even delayed timer dispatch must not turn a late successful write into a pass.
        long ticks = 0;
        using var timedSource = new MemoryStream([1, 2]);
        using var timedSink = new ControlledWriteStream();
        var postcheck = new ByteRelay(timedSource, timedSink, CancellationToken.None,
            elapsed: () => TimeSpan.FromTicks(Interlocked.Read(ref ticks)));
        await timedSink.Entered.Task;
        Interlocked.Exchange(ref ticks, TimeSpan.FromMilliseconds(AdapterProtocol.WriteMilliseconds).Ticks);
        timedSink.Release.SetResult();
        var delayed = await postcheck.SettleAsync(CancellationToken.None);
        Check(delayed.Settled && delayed.Failure == "stdioWriteStalled");

        // The same budget can expire during cleanup without any I/O exception at all.
        using var heldSource = new ControlledReadStream();
        using var heldSink = new MemoryStream();
        var heldRelay = new ByteRelay(heldSource, heldSink, CancellationToken.None);
        using var cleanup = new CancellationTokenSource();
        var state = Stopped();
        var finishing = RelayFinalization.FinishAsync(state, cleanup.Token, heldRelay);
        Check(!finishing.IsCompleted);
        cleanup.Cancel();
        Check(!await finishing && state.Cleanup == "cleanupUnverified");
        heldSource.Next.SetResult([]);
        Check((await heldRelay.SettleAsync(CancellationToken.None)).Settled);
    }

    private sealed class ControlledWriteStream(bool synchronous = false) : MemoryStream
    {
        internal readonly TaskCompletionSource<ReadOnlyMemory<byte>> Entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal int Writes;
        internal bool WasDisposed;
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref Writes);
            Entered.TrySetResult(buffer);
            if (synchronous)
            {
                Release.Task.GetAwaiter().GetResult();
                return base.WriteAsync(buffer, CancellationToken.None);
            }
            return WriteLaterAsync(buffer);
        }
        private async ValueTask WriteLaterAsync(ReadOnlyMemory<byte> buffer)
        {
            await Release.Task; // Deliberately ignores cancellation like synchronous native I/O.
            await base.WriteAsync(buffer, CancellationToken.None);
        }
        protected override void Dispose(bool disposing) { WasDisposed = true; base.Dispose(disposing); }
    }

    private sealed class ControlledReadStream : MemoryStream
    {
        internal readonly TaskCompletionSource<byte[]> Next = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource<byte[]> Tail = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource ReadAgain = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int reads;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            reads++;
            if (reads > 2) return 0;
            if (reads == 2) ReadAgain.SetResult();
            var bytes = await (reads == 1 ? Next.Task : Tail.Task).WaitAsync(cancellationToken);
            bytes.CopyTo(buffer); return bytes.Length;
        }
    }
}
