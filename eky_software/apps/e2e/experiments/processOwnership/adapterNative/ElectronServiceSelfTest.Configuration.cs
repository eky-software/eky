using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class ElectronServiceSelfTest
{
    private const string Version = "43.0.0";
    private const string PackageRoot = @"C:\source\node_modules\.pnpm\electron@43.0.0\node_modules\electron";
    private static Dictionary<string, object?> Configuration() => new()
    {
        ["protocol"] = ElectronServiceConfiguration.Protocol, ["schemaVersion"] = 1,
        ["generation"] = Generation, ["launchNonce"] = Nonce, ["electronExecutable"] = PackageRoot + @"\dist\electron.exe",
        ["repositoryRoot"] = @"C:\source", ["osTempRoot"] = @"C:\temp", ["runRoot"] = @"C:\temp\eky-e2e\run-synthetic",
        ["controlRoot"] = @"C:\temp\eky-e2e\run-synthetic\owner", ["runtimeRoot"] = @"C:\temp\eky-e2e\run-synthetic\worker",
        ["runtimeConfigPath"] = @"C:\temp\eky-e2e\run-synthetic\worker\electron-config.json",
        ["environment"] = EnvironmentFor(@"C:\temp\eky-e2e\run-synthetic\worker", @"C:\Windows"),
        ["workBudgetMilliseconds"] = 15000,
    };

    private static Dictionary<string, string> EnvironmentFor(string runtimeRoot, string systemRoot) => new()
    {
        ["EKY_E2E"] = "1", ["NODE_ENV"] = "test", ["SystemRoot"] = systemRoot, ["WINDIR"] = systemRoot,
        ["EKY_ELECTRON_E2E_CONFIG"] = Path.Combine(runtimeRoot, "electron-config.json"), ["EKY_ELECTRON_E2E_RUN_ROOT"] = runtimeRoot,
        ["HOME"] = Path.Combine(runtimeRoot, "windows-profile"), ["USERPROFILE"] = Path.Combine(runtimeRoot, "windows-profile"),
        ["APPDATA"] = Path.Combine(runtimeRoot, "windows-profile", "AppData", "Roaming"),
        ["LOCALAPPDATA"] = Path.Combine(runtimeRoot, "windows-profile", "AppData", "Local"),
        ["TEMP"] = Path.Combine(runtimeRoot, "windows-profile", "Temp"), ["TMP"] = Path.Combine(runtimeRoot, "windows-profile", "Temp"),
    };

    private static void TestConfiguration()
    {
        using var document = Json(Configuration());
        var config = ElectronServiceConfiguration.Parse(document.RootElement);
        Check(config.WorkBudgetMilliseconds == 15000 && config.PipeName == $"eky-e2e-electron-v1-{Generation}");
        Check(config.ConfigurationPath == config.ControlRoot + @"\electron-service-config.json");
        Check(config.TerminalPath == config.ControlRoot + @"\electron-service-terminal.json");
        Check(config.Arguments.SequenceEqual(new[] { @"C:\source\apps\desktop\e2e-dist" }));
        Reject(() => BackendServiceConfiguration.Parse(document.RootElement));
        Reject(() => ViteServiceConfiguration.Parse(document.RootElement));
        foreach (var key in Configuration().Keys)
        {
            var values = Configuration(); values.Remove(key);
            using var invalid = Json(values); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in new[] { "nodeExecutable", "webPort", "runtimeSession", "args", "command", "entrypoint", "cwd", "cleanupBudgetMilliseconds" })
        {
            var values = Configuration(); values[key] = "rejected";
            using var invalid = Json(values); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var invalidValue in new object?[] { null, 0, -1, 1.5, "15000", true, (long)int.MaxValue + 1 })
        {
            var values = Configuration(); values["workBudgetMilliseconds"] = invalidValue;
            using var invalid = Json(values); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var budget in new[] { 1, 15000, 30000, int.MaxValue })
        {
            var values = Configuration(); values["workBudgetMilliseconds"] = budget;
            using var valid = Json(values); Check(ElectronServiceConfiguration.Parse(valid.RootElement).WorkBudgetMilliseconds == budget);
        }
        foreach (var change in new Action<Dictionary<string, object?>>[]
        {
            value => value["protocol"] = BackendServiceProtocol.Name, value => value["protocol"] = ViteServiceConfiguration.Protocol,
            value => value["schemaVersion"] = 2, value => value["generation"] = "short", value => value["launchNonce"] = new string('B', 64),
        })
        {
            var values = Configuration(); change(values);
            using var invalid = Json(values); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in config.Environment.Keys)
        {
            var values = Configuration(); ((Dictionary<string, string>)values["environment"]!).Remove(key);
            using var invalid = Json(values); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in new[] { "Path", "path", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_SANDBOX",
            "EKY_E2E_RUNTIME_SESSION", "EKY_E2E_OS_TEMP_ROOT", "SECRET", "home", "systemroot" })
        {
            var values = Configuration(); ((Dictionary<string, string>)values["environment"]!)[key] = "rejected";
            using var invalid = Json(values); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var path in new[] { "", @"C:\synthetic;D:\synthetic", new string('x', 2048) })
        {
            var values = Configuration(); ((Dictionary<string, string>)values["environment"]!)["PATH"] = path;
            using var valid = Json(values); Check(ElectronServiceConfiguration.Parse(valid.RootElement).Environment["PATH"] == path);
        }
        foreach (var path in new object?[] { null, 1, new[] { "path" }, new string('x', 2049), "path\0tail" })
        {
            var values = Configuration();
            var environment = config.Environment.ToDictionary(pair => pair.Key, pair => (object?)pair.Value);
            environment["PATH"] = path; values["environment"] = environment;
            using var invalid = Json(values); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement));
        }
        using var duplicate = JsonDocument.Parse(JsonSerializer.Serialize(Configuration()).Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"));
        Reject(() => ElectronServiceConfiguration.Parse(duplicate.RootElement));
        Check(!config.Environment.ContainsKey("EKY_E2E_OS_TEMP_ROOT") && !config.Environment.ContainsKey("PATH"));
    }

    private static void TestLayout()
    {
        using var document = Json(Configuration());
        var config = ElectronServiceConfiguration.Parse(document.RootElement);
        config.ValidateLayout(); Check(true);
        foreach (var invalid in new[]
        {
            config with { ElectronExecutable = @"C:\runtime\..\electron.exe" },
            config with { RepositoryRoot = @"\\server\share" }, config with { RepositoryRoot = config.RunRoot },
            config with { RepositoryRoot = config.RunRoot + @"\source" }, config with { RepositoryRoot = config.OsTempRoot },
            config with { RunRoot = @"C:\temp\eky-e2e\other" }, config with { RunRoot = @"D:\temp\eky-e2e\run-synthetic" },
            config with { ControlRoot = config.RunRoot }, config with { ControlRoot = config.RunRoot + @"-sibling\owner" },
            config with { ControlRoot = config.RuntimeRoot }, config with { ControlRoot = config.RuntimeRoot + @"\owner" },
            config with { RuntimeRoot = config.ControlRoot + @"\worker" }, config with { RuntimeRoot = config.RunRoot },
            config with { RuntimeRoot = config.RunRoot + @"-sibling\worker" }, config with { RuntimeRoot = config.RuntimeRoot + @"\..\worker" },
            config with { RuntimeConfigPath = config.RuntimeRoot + @"\other.json" }, config with { RuntimeConfigPath = config.RuntimeRoot + @"\child\electron-config.json" },
            config with { RuntimeConfigPath = config.ControlRoot + @"\electron-config.json" },
        }) Reject(invalid.ValidateLayout);
        foreach (var key in config.Environment.Keys.Where(key => key is not ("EKY_E2E" or "NODE_ENV")))
        {
            var env = new Dictionary<string, string>(config.Environment) { [key] = @"relative\path" };
            Reject((config with { Environment = env }).ValidateLayout);
        }
        foreach (var key in config.Environment.Keys.Where(key => key is not ("EKY_E2E" or "NODE_ENV" or "SystemRoot" or "WINDIR")))
        foreach (var path in new[] { config.RunRoot, config.ControlRoot, @"C:\temp\eky-e2e\run-other\worker" })
        {
            var env = new Dictionary<string, string>(config.Environment) { [key] = path };
            Reject((config with { Environment = env }).ValidateLayout);
        }
        foreach (var pair in new[] { ("EKY_E2E", "0"), ("NODE_ENV", "production"), ("TEMP", config.RuntimeRoot + @"\windows-profile\Temp:stream") })
        {
            var env = new Dictionary<string, string>(config.Environment) { [pair.Item1] = pair.Item2 };
            Reject((config with { Environment = env }).ValidateLayout);
        }
    }
}
