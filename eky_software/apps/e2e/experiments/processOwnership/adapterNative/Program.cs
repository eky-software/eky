using System.Runtime.Versioning;

[assembly: SupportedOSPlatform("windows")]

namespace Eky.ProcessOwnershipAdapter;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        AdapterConfiguration? bridgeConfig = null;
        try
        {
            if (args.SequenceEqual(["--self-test"])) return await AdapterSelfTest.RunAsync();
            if (args.Length == 2 && args[0] == "--owner")
            {
                using var owner = new AdapterOwner(AdapterConfiguration.Read(args[1]));
                return await owner.RunAsync();
            }
            var path = Environment.GetEnvironmentVariable("EKY_T3C_CONFIG") ?? throw new AdapterFailure("configurationMissing");
            bridgeConfig = AdapterConfiguration.Read(path);
            return await AdapterBridge.RunAsync(bridgeConfig, args);
        }
        catch (Exception failure)
        {
            // No exception, command line, environment, or local path reaches console output.
            // Failed config validation does not authorize writing to an untrusted path.
            if (bridgeConfig is not null) return BridgeFailureEvidence.Record(bridgeConfig, BridgePhase.Setup, failure);
            return 1;
        }
    }
}
