using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

namespace Eky.ProcessOwnershipAdapter;

internal sealed class AdapterOwner(AdapterConfiguration config) : IDisposable
{
    private readonly AdapterState state = new();
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly CancellationTokenSource lifetime = new(AdapterProtocol.WorkMilliseconds + AdapterProtocol.CleanupMilliseconds);
    private readonly CancellationTokenSource launchCancellation = new();
    private readonly CancellationTokenSource relayCancellation = new();
    private WindowsJob? job;
    private AdapterProcess? child;
    private ChildStandardIo? io;
    private NamedPipeServerStream? caller;
    private NamedPipeServerStream? bridge;
    private NamedPipeServerStream? output;
    private NamedPipeServerStream? error;
    private ByteRelay? outputRelay;
    private ByteRelay? errorRelay;
    private long? cleanupUntil;
    private long sequence;
    private bool terminalWritten;
    private bool bridgeClosed;
    private bool rootSent;

    internal async Task<int> RunAsync()
    {
        // Last-resort self-exit releases the non-inherited Job handle. It never manufactures a receipt.
        using var watchdog = new Timer(_ => Environment.Exit(1), null,
            AdapterProtocol.WorkMilliseconds + AdapterProtocol.CleanupMilliseconds, Timeout.Infinite);
        Task<JsonDocument?>? callerRead = null;
        Task<JsonDocument?>? launchRead = null;
        Task<JsonDocument?>? bridgeRead = null;
        Task? callerLost = null;
        using var launchLifetime = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, launchCancellation.Token);
        try
        {
            job = WindowsJob.Create();
            caller = LocalControlPipe.Create(config.PipeName("caller"), PipeDirection.InOut);
            bridge = LocalControlPipe.Create(config.PipeName("bridge"), PipeDirection.InOut);
            output = LocalControlPipe.Create(config.PipeName("stdout"), PipeDirection.Out);
            error = LocalControlPipe.Create(config.PipeName("stderr"), PipeDirection.Out);
            callerRead = ConnectCallerAsync(lifetime.Token);
            launchRead = ConnectBridgeAsync(launchLifetime.Token);
            callerLost = Task.Run(() => ObserveCallerInputAsync(lifetime.Token));
            while (!state.StopRequested)
            {
                Observe();
                RelayFinalization.CaptureFailures(state, outputRelay, errorRelay);
                if (clock.ElapsedMilliseconds >= AdapterProtocol.WorkMilliseconds) throw new AdapterFailure("workDeadlineExceeded");
                if (callerLost.IsCompleted) { await callerLost; throw new AdapterFailure("callerLost"); }

                if (callerRead.IsCompleted)
                {
                    using var frame = await callerRead;
                    if (frame is null) throw new AdapterFailure("callerLost");
                    var request = AdapterProtocol.Caller(frame.RootElement, config.Generation, sequence);
                    sequence = request.Sequence;
                    if (request.Kind == "stop")
                    {
                        await StopAsync();
                        if (!terminalWritten) throw new AdapterFailure("cleanupUnverified");
                        await ReplyAsync(sequence, "terminal");
                        await AwaitCallerCloseAsync(lifetime.Token);
                        return ExitCode();
                    }
                    if (request.Kind == "breakBridge")
                    {
                        state.BreakBridge();
                        // Close only after pending writes settle; then the bridge can drain to EOF
                        // before its deliberate exit. Remaining child output is drained by the owner.
                        using var detach = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                        detach.CancelAfter(AdapterProtocol.WriteMilliseconds);
                        await Task.WhenAll(outputRelay!.DetachDestinationAsync(detach.Token),
                            errorRelay!.DetachDestinationAsync(detach.Token));
                        RelayFinalization.CaptureFailures(state, outputRelay, errorRelay);
                        if (state.Failure is { } failure) throw new AdapterFailure(failure);
                        await ControlFrame.WriteAsync(bridge,
                            new { schemaVersion = 1, generation = config.Generation, kind = "exitForTest", exitCode = AdapterProtocol.BridgeTestExitCode },
                            lifetime.Token);
                    }
                    await ReplyAsync(sequence, "snapshot");
                    callerRead = ControlFrame.ReadAsync(caller, lifetime.Token);
                }

                if (launchRead is not null && launchRead.IsCompleted)
                {
                    using var frame = await launchRead;
                    launchRead = null;
                    if (frame is null) throw new AdapterFailure("launchMissing");
                    var args = AdapterProtocol.Launch(frame.RootElement, config);
                    Launch(args);
                    await ControlFrame.WriteAsync(bridge, new { schemaVersion = 1, generation = config.Generation, kind = "started" }, lifetime.Token);
                    bridgeRead = ControlFrame.ReadAsync(bridge, lifetime.Token);
                }

                Observe();
                if (state.RootExited && !rootSent)
                {
                    rootSent = true;
                    try
                    {
                        if (!bridgeClosed && !state.BreakRequested)
                            await ControlFrame.WriteAsync(bridge, new { schemaVersion = 1, generation = config.Generation,
                                kind = "rootExit", exitCode = state.RootExitCode }, lifetime.Token);
                    }
                    catch (IOException) { bridgeClosed = true; }
                }
                if (bridgeRead is not null && bridgeRead.IsCompleted)
                {
                    using var frame = await ReadBridgeEndAsync(bridgeRead);
                    bridgeRead = null;
                    bridgeClosed = true;
                    if (frame is not null) throw new AdapterFailure("launchReplay");
                    state.LoseBridge();
                }
                RelayFinalization.CaptureFailures(state, outputRelay, errorRelay);
                var observations = new List<Task> { callerRead, callerLost, Task.Delay(AdapterProtocol.PollMilliseconds, lifetime.Token) };
                if (launchRead is not null) observations.Add(launchRead);
                if (bridgeRead is not null) observations.Add(bridgeRead);
                await Task.WhenAny(observations);
            }
            throw new AdapterFailure("stateInvalid");
        }
        catch (Exception failure)
        {
            state.Fail(SafeFailure(failure));
            try { await StopAsync(); } catch { state.Fail("cleanupUnverified"); }
            if (bridge?.IsConnected == true && !bridgeClosed)
            {
                try { await ControlFrame.WriteAsync(bridge, new { schemaVersion = 1, generation = config.Generation,
                    kind = "error", errorCode = state.Failure }, lifetime.Token); }
                catch { /* A lost bridge cannot prevent tree cleanup or retained evidence. */ }
            }
            if (terminalWritten && caller?.IsConnected == true && sequence > 0)
            {
                try { await ReplyAsync(sequence, "terminal"); } catch { /* Evidence survives a lost control channel. */ }
            }
            return 1;
        }
        finally
        {
            launchCancellation.Cancel();
            relayCancellation.Cancel();
            lifetime.Cancel();
            foreach (var task in new Task?[] { callerRead, launchRead, bridgeRead, callerLost })
                if (task is not null) _ = task.ContinueWith(completed => { _ = completed.Exception; },
                    CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }
    }

    private async Task<JsonDocument?> ConnectCallerAsync(CancellationToken cancellation)
    {
        await caller!.WaitForConnectionAsync(cancellation);
        return await ControlFrame.ReadAsync(caller, cancellation);
    }

    private async Task<JsonDocument?> ConnectBridgeAsync(CancellationToken cancellation)
    {
        await Task.WhenAll(bridge!.WaitForConnectionAsync(cancellation), output!.WaitForConnectionAsync(cancellation),
            error!.WaitForConnectionAsync(cancellation));
        return await ControlFrame.ReadAsync(bridge, cancellation);
    }

    private static async Task ObserveCallerInputAsync(CancellationToken cancellation)
    {
        using var input = Console.OpenStandardInput();
        var one = new byte[1];
        var count = await input.ReadAsync(one, cancellation);
        if (count != 0) throw new AdapterFailure("callerInputInvalid");
    }

    private static async Task<JsonDocument?> ReadBridgeEndAsync(Task<JsonDocument?> read)
    {
        try { return await read; }
        catch (IOException) { return null; }
    }

    private void Launch(string[] args)
    {
        state.RequireLaunch();
        try
        {
            io = ChildStandardIo.Create();
            child = AdapterProcess.Create(config, args, job!, io);
            state.Created();
            child.VerifyAndResume(job!, state);
            io.CloseChildEnds();
            outputRelay = new ByteRelay(io.OutputReader, output!, relayCancellation.Token, closeDestination: true);
            errorRelay = new ByteRelay(io.ErrorReader, error!, relayCancellation.Token, closeDestination: true);
        }
        finally { state.SettleCreation(); }
    }

    private void Observe()
    {
        var exited = child?.HasExited() == true;
        state.Observe(exited, exited ? child!.ExitCode() : null, job?.GetActiveProcessCount() ?? 0);
    }

    private async Task StopAsync()
    {
        if (state.StopRequested && terminalWritten) return;
        cleanupUntil ??= Math.Min(clock.ElapsedMilliseconds + AdapterProtocol.CleanupMilliseconds,
            AdapterProtocol.WorkMilliseconds + AdapterProtocol.CleanupMilliseconds);
        using var cleanup = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        cleanup.CancelAfter(TimeSpan.FromMilliseconds(Math.Max(0, cleanupUntil.Value - clock.ElapsedMilliseconds)));
        RelayFinalization.CaptureFailures(state, outputRelay, errorRelay);
        state.BeginStop();
        launchCancellation.Cancel();
        io?.CloseChildEnds();
        try
        {
            Observe();
            if (state.ActiveProcesses > 0) job!.Terminate();
            while (!state.CanProveAbsent && clock.ElapsedMilliseconds < cleanupUntil.Value)
            {
                await Task.Delay(AdapterProtocol.PollMilliseconds, cleanup.Token);
                Observe();
            }
            var settled = await RelayFinalization.FinishAsync(state, cleanup.Token, outputRelay, errorRelay);
            if (!settled || clock.ElapsedMilliseconds >= cleanupUntil.Value)
            {
                state.UnverifiedCleanup();
                return;
            }
            config.WriteTerminal(state.Snapshot());
            terminalWritten = true;
        }
        catch { state.UnverifiedCleanup(); }
    }

    private Task ReplyAsync(long currentSequence, string kind) => ControlFrame.WriteAsync(caller!,
        new { schemaVersion = 1, generation = config.Generation, sequence = currentSequence, kind, state = state.Snapshot() }, lifetime.Token);

    private async Task AwaitCallerCloseAsync(CancellationToken cancellation)
    {
        // Receipt has settled creation and the entire Job. Repeated stop is read-only.
        while (true)
        {
            using var frame = await ControlFrame.ReadAsync(caller!, cancellation);
            if (frame is null) return;
            var request = AdapterProtocol.Caller(frame.RootElement, config.Generation, sequence);
            sequence = request.Sequence;
            if (request.Kind == "breakBridge") throw new AdapterFailure("breakBridgeInvalid");
            await ReplyAsync(sequence, request.Kind == "stop" ? "terminal" : "snapshot");
        }
    }

    private int ExitCode() => terminalWritten && state.Cleanup == "processTreeAbsent" && state.Failure is null ? 0 : 1;
    internal static string SafeFailure(Exception exception) => exception switch
    {
        AdapterFailure failure => failure.Code,
        SupervisorFailure => "nativeOperationFailed",
        OperationCanceledException => "deadlineExceeded",
        IOException => "controlIoFailed",
        JsonException => "frameInvalid",
        _ => "adapterInternalFailure",
    };

    public void Dispose()
    {
        // Closing this non-inherited handle is also the final emergency boundary.
        job?.Dispose();
        caller?.Dispose(); bridge?.Dispose(); output?.Dispose(); error?.Dispose();
        child?.Dispose(); io?.Dispose();
        lifetime.Dispose(); launchCancellation.Dispose(); relayCancellation.Dispose();
    }
}
