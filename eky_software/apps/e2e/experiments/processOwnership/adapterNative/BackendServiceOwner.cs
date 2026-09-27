using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

namespace Eky.ProcessOwnershipAdapter;

internal sealed class BackendServiceOwner(ServiceConfiguration config, BackendServiceClock clock) : IDisposable
{
    private readonly BackendServiceState state = new();
    private readonly CancellationTokenSource session = new();
    private readonly CancellationTokenSource relayCancellation = new();
    private WindowsJob? job;
    private AdapterProcess? child;
    private ChildStandardIo? io;
    private WindowsStandardPipeSink? output;
    private WindowsStandardPipeSink? error;
    private ByteRelay? outputRelay;
    private ByteRelay? errorRelay;
    private NamedPipeServerStream? caller;
    private Task<JsonDocument?>? read;
    private BackendServiceSnapshot? terminal;
    private Timer? watchdog;
    private long requestSequence;
    private long replySequence;
    private long? pendingReply;
    private bool rootSent;

    internal static async Task<int> RunConfiguredAsync(string path, ServiceProfile profile = ServiceProfile.Backend)
    {
        // Includes config validation time; receiving a launch never resets this origin.
        var origin = Stopwatch.StartNew();
        var config = ServiceConfiguration.Read(path, profile);
        using var owner = new BackendServiceOwner(config, new(config.WorkBudgetMilliseconds, () => origin.ElapsedMilliseconds));
        return await owner.RunAsync();
    }

    private async Task<int> RunAsync()
    {
        watchdog = new Timer(_ => Environment.Exit(1), null,
            TimeSpan.FromMilliseconds(clock.RemainingWork + BackendServiceProtocol.CleanupMilliseconds), Timeout.InfiniteTimeSpan);
        try
        {
            try
            {
                job = WindowsJob.Create();
                caller = LocalControlPipe.Create(config.PipeName, PipeDirection.InOut);
                clock.RequireWork();
                using (var connectionBound = Bound()) await caller.WaitForConnectionAsync(connectionBound.Token);
                clock.RequireWork();
                read = ControlFrame.ReadAsync(caller, session.Token);
                await WorkAsync();
            }
            catch (Exception failure)
            {
                state.Fail(failure is OperationCanceledException && clock.RemainingWork == 0
                    ? "workDeadlineExceeded" : BackendServiceProtocol.OperationalFailure(failure));
            }
            try { return await StopAndCloseAsync(); }
            catch { return 1; }
        }
        finally
        {
            // Emergency Job close is containment only, never a substitute for the terminal protocol.
            job?.Dispose();
            session.Cancel();
            relayCancellation.Cancel();
            if (read is not null) _ = read.ContinueWith(completed => { _ = completed.Exception; }, CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }
    }

    private async Task WorkAsync()
    {
        while (true)
        {
            clock.RequireWork();
            Observe();
            if (outputRelay?.Failure is not null || errorRelay?.Failure is not null) throw new AdapterFailure("stdioFailed");
            if (state.Workload == "exited" && !rootSent)
            {
                await ReplyAsync("rootExit", null);
                rootSent = true;
            }
            if (read!.IsCompleted)
            {
                using var frame = await read;
                read = null;
                if (frame is null) throw new AdapterFailure("callerLost");
                var request = BackendServiceProtocol.Request(frame.RootElement, config.Generation, config.LaunchNonce, requestSequence, config.Profile);
                requestSequence = request.Sequence;
                pendingReply = request.Sequence;
                if (request.Kind == "stop") return;
                if (request.Kind == "launch")
                {
                    Launch(request.WorkDeadlineElapsedMilliseconds ?? throw new AdapterFailure("protocolInvalid"));
                    clock.RequireWork();
                    Observe();
                    await ReplyAsync("started", request.Sequence);
                }
                else
                {
                    Observe();
                    long? rss = null;
                    if (request.Kind == "rss" && state.Workload == "running")
                    {
                        try { rss = child!.ReadBackendRss(); }
                        catch { state.Fail("observationLost"); }
                        Observe();
                        if (state.Workload != "running") rss = null;
                    }
                    await ReplyAsync(request.Kind, request.Sequence, rss);
                }
                pendingReply = null;
                if (state.FirstFailure is { } failure) throw new AdapterFailure(failure);
                read = ControlFrame.ReadAsync(caller!, session.Token);
            }
            await Task.WhenAny(read!, Task.Delay(AdapterProtocol.PollMilliseconds, session.Token));
        }
    }

    private void Launch(long workDeadlineElapsedMilliseconds)
    {
        state.AdmitLaunch();
        try
        {
            clock.LatchWorkDeadline(workDeadlineElapsedMilliseconds);
            watchdog!.Change(TimeSpan.FromMilliseconds(clock.RemainingWork + BackendServiceProtocol.CleanupMilliseconds),
                Timeout.InfiniteTimeSpan);
            clock.RequireWork();
            try { config.ValidatePaths(); }
            catch { throw new AdapterFailure("launchRejected"); }
            clock.RequireWork();
            io = ChildStandardIo.Create();
            output = new WindowsStandardPipeSink(false);
            error = new WindowsStandardPipeSink(true);
            outputRelay = new ByteRelay(io.OutputReader, output, relayCancellation.Token, closeDestination: true);
            errorRelay = new ByteRelay(io.ErrorReader, error, relayCancellation.Token, closeDestination: true);
            clock.RequireWork();
            child = AdapterProcess.CreateService(config, job!, io, state);
            state.Identify(child.ReadBackendIdentity());
            clock.RequireWork();
            child.VerifyAndResume(job!, state);
            state.MarkStarted();
        }
        finally
        {
            state.SettleCreation();
            io?.CloseChildEnds();
        }
    }

    private void Observe()
    {
        try
        {
            var exited = child?.HasExited() == true;
            state.ObserveRoot(exited, exited ? child!.ExitCode() : null);
            if (job is null) throw new AdapterFailure("observationLost");
            state.ObserveJob(job.GetActiveProcessCount());
        }
        catch
        {
            state.LoseObservation();
            throw new AdapterFailure("observationLost");
        }
    }

    private CancellationTokenSource Bound()
    {
        var remaining = state.Stopping ? clock.RemainingCleanup ?? 0 : clock.RemainingWork;
        if (remaining <= 0) throw new AdapterFailure(state.Stopping ? "cleanupDeadlineExceeded" : "workDeadlineExceeded");
        var bound = CancellationTokenSource.CreateLinkedTokenSource(session.Token);
        bound.CancelAfter(TimeSpan.FromMilliseconds(remaining));
        return bound;
    }

    private async Task ReplyAsync(string kind, long? replyTo, long? rss = null)
    {
        using var bound = Bound();
        if (replySequence >= BackendServiceProtocol.MaximumSequence) throw new AdapterFailure("protocolInvalid");
        var timing = clock.ReadTiming();
        var reply = new BackendServiceReply(ServiceConfiguration.Protocol(config.Profile), BackendServiceProtocol.Version, config.Generation,
            ++replySequence, replyTo, kind, terminal ?? state.Snapshot(), rss, timing.ElapsedMilliseconds,
            timing.CleanupStartedElapsedMilliseconds, timing.RemainingCleanupMilliseconds);
        await ControlFrame.WriteAsync(caller!, reply, bound.Token);
        if (state.Stopping) clock.RequireCleanup(); else clock.RequireWork();
    }

    private async Task<int> StopAndCloseAsync()
    {
        clock.BeginStop();
        state.BeginStop();
        watchdog!.Change(TimeSpan.FromMilliseconds(clock.RemainingCleanup!.Value), Timeout.InfiniteTimeSpan);
        using var cleanup = Bound();
        await CleanupAsync(cleanup.Token);
        var candidate = state.Snapshot(state.CanProveAbsent ? "processTreeAbsent" : "cleanupUnverified");
        try { config.WriteTerminal(candidate, clock.CleanupStarted!.Value, clock.RequireCleanup); }
        catch (AdapterFailure failure) when (failure.Code == "cleanupDeadlineExceeded") { state.FailCleanup("cleanupDeadlineExceeded"); }
        catch { state.FailCleanup("evidenceWriteFailed"); }
        terminal = state.Freeze(clock.RemainingCleanup > 0);
        if (caller?.IsConnected != true) return 1;
        var unsolicited = pendingReply is null;
        await ReplyAsync("terminal", pendingReply);
        pendingReply = null;
        // Terminal delivery, repeated stop replies, peer EOF and successful return share this bound.
        while (true)
        {
            clock.RequireCleanup();
            read ??= ControlFrame.ReadAsync(caller, session.Token);
            using var frame = await read.WaitAsync(cleanup.Token);
            read = null;
            if (frame is null)
            {
                clock.RequireCleanup();
                return terminal.Cleanup == "processTreeAbsent" ? 0 : 1;
            }
            var request = BackendServiceProtocol.Request(frame.RootElement, config.Generation, config.LaunchNonce, requestSequence, config.Profile);
            requestSequence = request.Sequence;
            // A request may cross an unsolicited terminal, which already settled the caller's
            // pending request. Return the same terminal without reopening launch or correlating twice.
            await ReplyAsync("terminal", unsolicited ? null : request.Sequence);
        }
    }

    private async Task CleanupAsync(CancellationToken cancellation)
    {
        io?.CloseChildEnds();
        try { if (job is not null) job.Terminate(); }
        catch { state.FailCleanup("jobTerminateFailed"); }
        try
        {
            while (true)
            {
                clock.RequireCleanup();
                Observe();
                if (state.TreeSettled) break;
                await Task.Delay(AdapterProtocol.PollMilliseconds, cancellation);
            }
        }
        catch (OperationCanceledException) { state.FailCleanup("cleanupDeadlineExceeded"); }
        catch (AdapterFailure failure)
        { state.FailCleanup(failure.Code == "cleanupDeadlineExceeded" ? failure.Code : "observationLost"); }
        try
        {
            var relays = new[] { outputRelay, errorRelay }.Where(relay => relay is not null).Select(relay => relay!).ToArray();
            var settled = await Task.WhenAll(relays.Select(relay => relay.SettleAsync(cancellation)));
            state.SetStdioSettled(settled.All(result => result.Settled));
            if (settled.Any(result => result.Failure is not null)) state.Fail("stdioFailed");
            if (!state.StdioSettled || clock.RemainingCleanup is not > 0) state.FailCleanup("cleanupDeadlineExceeded");
        }
        catch { state.FailCleanup("stdioFailed"); }
    }

    public void Dispose()
    {
        job?.Dispose();
        session.Cancel();
        relayCancellation.Cancel();
        caller?.Dispose();
        child?.Dispose();
        io?.Dispose();
        output?.Dispose();
        error?.Dispose();
        watchdog?.Dispose();
        session.Dispose();
        relayCancellation.Dispose();
    }
}
