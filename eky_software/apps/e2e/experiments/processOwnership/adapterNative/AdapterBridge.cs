using System.IO.Pipes;
using System.Diagnostics;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static class AdapterBridge
{
    internal static async Task<int> RunAsync(AdapterConfiguration config, string[] args)
    {
        try
        {
            return await CompleteDrainAsync(() => DrainAndDisposeAsync(config, args),
                code => BridgeDrainCompletion.Record(config, code));
        }
        catch (Exception failure) { return BridgeFailureEvidence.Record(config, BridgePhase.DrainOutput, failure); }
    }

    internal static async Task<int> CompleteDrainAsync(Func<Task<int>> drainAndDispose, Func<int, int> record)
    {
        var intendedExitCode = await drainAndDispose();
        return intendedExitCode == 1 ? 1 : record(intendedExitCode);
    }

    // Every using/finally disposal completes before the caller may write the pre-exit receipt.
    private static async Task<int> DrainAndDisposeAsync(AdapterConfiguration config, string[] args)
    {
        using var lifetime = new CancellationTokenSource(AdapterProtocol.WorkMilliseconds);
        using var relayCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        using var control = LocalControlPipe.Client(config.PipeName("bridge"), PipeDirection.InOut);
        using var output = LocalControlPipe.Client(config.PipeName("stdout"), PipeDirection.In);
        using var error = LocalControlPipe.Client(config.PipeName("stderr"), PipeDirection.In);
        ByteRelay? stdout = null;
        ByteRelay? stderr = null;
        WindowsStandardPipeSink? stdoutSink = null;
        WindowsStandardPipeSink? stderrSink = null;
        var phase = BridgePhase.ConnectPipes;
        try
        {
            await Task.WhenAll(control.ConnectAsync(lifetime.Token), output.ConnectAsync(lifetime.Token), error.ConnectAsync(lifetime.Token));
            phase = BridgePhase.ReadEnvironment;
            var environment = config.Environment.ToDictionary(entry => entry.Key,
                entry => Environment.GetEnvironmentVariable(entry.Key) ?? throw new AdapterFailure("environmentInvalid"), StringComparer.OrdinalIgnoreCase);
            var launch = new { schemaVersion = 1, generation = config.Generation, nonce = config.LaunchNonce, kind = "launch",
                args, cwd = Environment.CurrentDirectory, environment };
            // Validate the exact serialized request locally too, before any launch side effect.
            phase = BridgePhase.ValidateLaunch;
            var encoded = ControlFrame.Encode(launch);
            using (var document = AdapterProtocol.Parse(encoded.AsMemory(0, encoded.Length - 1)))
                AdapterProtocol.Launch(document.RootElement, config);
            phase = BridgePhase.OpenStdout;
            stdoutSink = new WindowsStandardPipeSink(standardError: false);
            phase = BridgePhase.OpenStderr;
            stderrSink = new WindowsStandardPipeSink(standardError: true);
            stdout = new ByteRelay(output, stdoutSink, relayCancellation.Token);
            stderr = new ByteRelay(error, stderrSink, relayCancellation.Token);
            phase = BridgePhase.SendLaunch;
            await ControlFrame.WriteAsync(control, launch, lifetime.Token);
            phase = BridgePhase.AwaitStarted;
            using (var started = await ReadControlAsync(control, stdout, stderr, lifetime.Token) ?? throw new AdapterFailure("controlMissing"))
            {
                AdapterProtocol.ExactKeys(started.RootElement, "schemaVersion", "generation", "kind");
                AdapterProtocol.Identity(started.RootElement, config.Generation);
                if (AdapterProtocol.Text(started.RootElement, "kind", 16) != "started") throw new AdapterFailure("controlInvalid");
            }
            phase = BridgePhase.AwaitRootExit;
            using var terminal = await ReadControlAsync(control, stdout, stderr, lifetime.Token) ?? throw new AdapterFailure("controlMissing");
            var value = terminal.RootElement;
            AdapterProtocol.ExactKeys(value, "schemaVersion", "generation", "kind", "exitCode");
            AdapterProtocol.Identity(value, config.Generation);
            var kind = AdapterProtocol.Text(value, "kind", 16);
            if (!value.GetProperty("exitCode").TryGetInt32(out var exitCode)) throw new AdapterFailure("controlInvalid");
            if (kind != "rootExit" && !(kind == "exitForTest" && exitCode == AdapterProtocol.BridgeTestExitCode))
                throw new AdapterFailure("controlInvalid");
            // Preserve all queued output before reporting the root exit. A held pipe is not success.
            phase = BridgePhase.DrainOutput;
            var drainClock = Stopwatch.StartNew();
            using var drain = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            drain.CancelAfter(AdapterProtocol.WriteMilliseconds);
            var relays = await Task.WhenAll(stdout.SettleAsync(drain.Token), stderr.SettleAsync(drain.Token));
            foreach (var relay in relays)
                if (relay.Failure is { } code) throw new AdapterFailure(code);
            if (drain.IsCancellationRequested || drainClock.ElapsedMilliseconds >= AdapterProtocol.WriteMilliseconds ||
                relays.Any(result => !result.Settled)) throw new AdapterFailure("stdioDrainUnsettled");
            return exitCode;
        }
        catch (Exception failure) { return BridgeFailureEvidence.Record(config, phase, failure); }
        finally
        {
            relayCancellation.Cancel();
            output.Dispose(); error.Dispose();
            // An unsettled synchronous write prevents success but cannot delay exit 1.
            // ByteRelay retains/observes it; SafeHandle keeps it valid until WriteFile returns.
            stdoutSink?.Dispose(); stderrSink?.Dispose();
        }
    }

    private static async Task<JsonDocument?> ReadControlAsync(Stream control, ByteRelay stdout, ByteRelay stderr,
        CancellationToken token)
    {
        var read = ControlFrame.ReadAsync(control, token);
        try { return await RelayFinalization.ControlOrFailureAsync(read, stdout, stderr, token); }
        catch
        {
            _ = read.ContinueWith(completed =>
            {
                if (completed.IsCompletedSuccessfully) completed.Result?.Dispose();
                else _ = completed.Exception;
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            throw;
        }
    }
}
