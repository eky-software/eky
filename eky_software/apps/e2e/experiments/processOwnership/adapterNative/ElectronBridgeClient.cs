using System.IO.Pipes;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

// A childless byte/control adapter for Playwright. Only the existing service
// owner creates, resumes or terminates the actual Electron workload.
internal static class ElectronBridgeClient
{
    internal const string ConfigurationKey = "EKY_E2E_ELECTRON_BRIDGE_CONFIG";
    internal const string GenerationKey = "EKY_E2E_ELECTRON_BRIDGE_GENERATION";
    internal const string NonceKey = "EKY_E2E_ELECTRON_BRIDGE_NONCE";
    internal const string BootstrapKey = "EKY_E2E_ELECTRON_BRIDGE_BOOTSTRAP";

    internal static async Task<int> RunConfiguredAsync(string[] arguments)
    {
        ElectronServiceConfiguration.RequireGuard();
        var generation = EnvironmentValue(GenerationKey, 64);
        var nonce = EnvironmentValue(NonceKey, 64);
        var bootstrap = ElectronBridgeBootstrap.Parse(EnvironmentValue(BootstrapKey, AdapterProtocol.FrameBytes - 1), generation, nonce);
        var deadline = ElectronBridgeClientDeadline.FromBootstrap(bootstrap);
        deadline.RequireRemaining();
        using var work = new CancellationTokenSource();
        using var watchdog = new Timer(_ => Environment.Exit(1), null, Timeout.Infinite, Timeout.Infinite);
        void ApplyDeadline(long? shorter = null)
        {
            if (shorter.HasValue) deadline.Shorten(shorter.Value);
            var remaining = deadline.RemainingMilliseconds;
            if (remaining == 0 || work.IsCancellationRequested) throw new AdapterFailure("workDeadlineExceeded");
            work.CancelAfter(TimeSpan.FromMilliseconds(remaining));
            watchdog.Change(TimeSpan.FromMilliseconds(remaining), Timeout.InfiniteTimeSpan);
        }
        ApplyDeadline();
        // Validation, including config/package reads, spends the already armed budget.
        var config = ElectronServiceConfiguration.Read(EnvironmentValue(ConfigurationKey, 1024), ServiceProfile.ElectronBridge);
        if (config.Generation != generation || config.LaunchNonce != nonce || Directory.GetCurrentDirectory() != config.RunRoot)
            throw new AdapterFailure("bridgeRegistrationInvalid");
        ElectronBridgeLaunch.RequireArguments(arguments, config);
        deadline.RequireRemaining();

        using var control = Pipe(config.PipeName + "-control", PipeDirection.InOut);
        using var output = Pipe(config.PipeName + "-output", PipeDirection.In);
        using var error = Pipe(config.PipeName + "-error", PipeDirection.In);
        await Task.WhenAll(control.ConnectAsync(work.Token), output.ConnectAsync(work.Token), error.ConnectAsync(work.Token));
        deadline.RequireRemaining();
        await ControlFrame.WriteAsync(control, new { protocol = ElectronBridgeServiceProtocol.Name,
            schemaVersion = BackendServiceProtocol.Version, generation, launchNonce = nonce, kind = "launch",
            cwd = config.RunRoot, args = arguments }, work.Token);
        deadline.RequireRemaining();
        var challenges = await BridgeRegistrationExchange.ReadChallengesAsync(control, output, error, generation, nonce, work.Token);
        deadline.RequireRemaining();
        using (var self = new SafeProcessHandle(AdapterNativeMethods.GetCurrentProcess(), ownsHandle: false))
        {
            if (!AdapterNativeMethods.GetProcessTimes(self, out var birth, out _, out _, out _))
                throw new AdapterFailure("processIdentityFailed");
            await ControlFrame.WriteAsync(control, BridgeRegistrationProtocol.Proof(generation, nonce,
                checked((uint)Environment.ProcessId), birth, challenges), work.Token);
        }
        deadline.RequireRemaining();
        using var stdout = new WindowsStandardPipeSink(false);
        using var stderr = new WindowsStandardPipeSink(true);
        var outputRelay = new ByteRelay(output, stdout, work.Token);
        var errorRelay = new ByteRelay(error, stderr, work.Token);
        try
        {
            return await ElectronBridgeClientRelay.RunAsync(control, outputRelay, errorRelay, generation, nonce,
                deadline.RequireRemaining, value => ApplyDeadline(value), work.Token);
        }
        finally { work.Cancel(); }
    }

    private static NamedPipeClientStream Pipe(string name, PipeDirection direction) =>
        new(".", name, direction, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification, HandleInheritability.None);

    private static string EnvironmentValue(string name, int maximum)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrEmpty(value) || value.Length > maximum || value.Contains('\0'))
            throw new AdapterFailure("configurationInvalid");
        return value;
    }
}
