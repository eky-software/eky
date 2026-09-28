using System.Security.Cryptography;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record ResumeFailureSelfTestFixture(string Root, ServiceConfiguration Config,
    string TerminalPath, string UnexpectedRunPath)
{
    internal static ResumeFailureSelfTestFixture Create(string nodeExecutable)
    {
        var root = Directory.CreateTempSubdirectory("eky-resume-failure-").FullName;
        var source = Path.Combine(root, "source");
        var runRoot = Path.Combine(root, "eky-e2e", "run-resume-failure");
        var control = Path.Combine(runRoot, "owner");
        var runtime = Path.Combine(runRoot, "runtime-config.json");
        var temp = Path.Combine(runRoot, "temp");
        var profile = Path.Combine(runRoot, "profile");
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var environment = new Dictionary<string, string>
        {
            ["EKY_E2E"] = "1", ["NODE_ENV"] = "test", ["SystemRoot"] = windows, ["WINDIR"] = windows,
            ["EKY_E2E_OS_TEMP_ROOT"] = root, ["TEMP"] = temp, ["TMP"] = temp,
            ["USERPROFILE"] = profile, ["APPDATA"] = profile, ["LOCALAPPDATA"] = profile,
        };
        var config = new BackendServiceConfiguration(Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)),
            Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)), nodeExecutable, source, root,
            runRoot, control, runtime, environment, AdapterProtocol.WorkMilliseconds);
        foreach (var directory in new[] { Path.GetDirectoryName(config.Entrypoint)!, control, temp, profile })
            Directory.CreateDirectory(directory);
        File.WriteAllText(config.Entrypoint,
            "require('node:fs').writeFileSync(process.argv[3] + '.unexpected-run', 'unexpected'); process.exit(91);\n");
        File.WriteAllText(runtime, "{}");
        File.WriteAllText(config.ConfigurationPath, JsonSerializer.Serialize(new
        {
            protocol = BackendServiceProtocol.Name, schemaVersion = BackendServiceProtocol.Version,
            config.Generation, config.LaunchNonce, config.NodeExecutable, config.RepositoryRoot, config.OsTempRoot,
            config.RunRoot, config.ControlRoot, config.RuntimeConfigPath, config.Environment, config.WorkBudgetMilliseconds,
        }, AdapterProtocol.Json));
        return new(root, ServiceConfiguration.Read(config.ConfigurationPath, ServiceProfile.Backend),
            config.TerminalPath, runtime + ".unexpected-run");
    }

    internal void RemoveVerifiedRoot()
    {
        BackendServiceConfiguration.RequireCanonicalPath(Root, true);
        Directory.Delete(Root, true);
    }
}
