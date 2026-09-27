using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class ViteServiceSelfTest
{
    private static Dictionary<string, object?> Configuration() => new()
    {
        ["protocol"] = ViteServiceConfiguration.Protocol, ["schemaVersion"] = 1,
        ["generation"] = Generation, ["launchNonce"] = Nonce, ["nodeExecutable"] = @"C:\runtime\node.exe",
        ["repositoryRoot"] = @"C:\source", ["osTempRoot"] = @"C:\temp", ["runRoot"] = @"C:\temp\eky-e2e\run-synthetic",
        ["controlRoot"] = @"C:\temp\eky-e2e\run-synthetic\owner", ["webPort"] = 4300,
        ["environment"] = new Dictionary<string, string>
        {
            ["EKY_E2E"] = "1", ["NODE_ENV"] = "test", ["SystemRoot"] = @"C:\Windows", ["WINDIR"] = @"C:\Windows",
            ["TEMP"] = @"C:\temp\eky-e2e\run-synthetic\owner\temp", ["TMP"] = @"C:\temp\eky-e2e\run-synthetic\owner\temp",
            ["USERPROFILE"] = @"C:\temp\eky-e2e\run-synthetic\owner\profile", ["APPDATA"] = @"C:\temp\eky-e2e\run-synthetic\owner\profile",
            ["LOCALAPPDATA"] = @"C:\temp\eky-e2e\run-synthetic\owner\profile", ["EKY_E2E_OS_TEMP_ROOT"] = @"C:\temp",
            ["EKY_E2E_BACKEND_ORIGIN"] = "http://127.0.0.1:4200", ["EKY_E2E_ENV_ROOT"] = @"C:\temp\eky-e2e\run-synthetic\temp",
        },
        ["workBudgetMilliseconds"] = 60000,
    };

    private static void TestConfiguration()
    {
        using var document = Json(Configuration());
        var config = ViteServiceConfiguration.Parse(document.RootElement);
        Check(config.WorkBudgetMilliseconds == 60000 && config.WebPort == 4300);
        Check(config.PipeName == $"eky-e2e-vite-v1-{Generation}");
        Check(config.ConfigurationPath == config.ControlRoot + @"\vite-service-config.json");
        Check(config.TerminalPath == config.ControlRoot + @"\vite-service-terminal.json");
        Check(config.WorkingDirectory == @"C:\source\apps\web");
        Reject(() => _ = config.Arguments);
        Reject(() => BackendServiceConfiguration.Parse(document.RootElement));
        foreach (var key in Configuration().Keys)
        {
            var values = Configuration(); values.Remove(key);
            using var invalid = Json(values); Reject(() => ViteServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in new[] { "runtimeConfigPath", "runtimeSession", "session", "args", "command", "entrypoint", "cwd", "cleanupBudgetMilliseconds" })
        {
            var values = Configuration(); values[key] = "rejected";
            using var invalid = Json(values); Reject(() => ViteServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var port in new object?[] { null, 0, -1, 65536, 1.5, "4300", true })
        {
            var values = Configuration(); values["webPort"] = port;
            using var invalid = Json(values); Reject(() => ViteServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var port in new[] { 1, 65535 })
        {
            var values = Configuration(); values["webPort"] = port;
            using var valid = Json(values); Check(ViteServiceConfiguration.Parse(valid.RootElement).WebPort == port);
        }
        foreach (var budget in new object?[] { null, 0, -1, 1.5, "60000", (long)int.MaxValue + 1 })
        {
            var values = Configuration(); values["workBudgetMilliseconds"] = budget;
            using var invalid = Json(values); Reject(() => ViteServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var change in new Action<Dictionary<string, object?>>[]
        {
            value => value["protocol"] = BackendServiceProtocol.Name, value => value["schemaVersion"] = 2,
            value => value["generation"] = "short", value => value["launchNonce"] = new string('B', 64),
        })
        {
            var values = Configuration(); change(values);
            using var invalid = Json(values); Reject(() => ViteServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in config.Environment.Keys)
        {
            var values = Configuration(); ((Dictionary<string, string>)values["environment"]!).Remove(key);
            using var invalid = Json(values); Reject(() => ViteServiceConfiguration.Parse(invalid.RootElement));
        }
        foreach (var key in new[] { "HOME", "PATH", "Path", "path", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE",
            "EKY_E2E_RUNTIME_SESSION", "SECRET", "eky_e2e_os_temp_root" })
        {
            var values = Configuration(); ((Dictionary<string, string>)values["environment"]!)[key] = "rejected";
            using var invalid = Json(values); Reject(() => ViteServiceConfiguration.Parse(invalid.RootElement));
        }
        using var duplicate = JsonDocument.Parse(JsonSerializer.Serialize(Configuration()).Replace("\"webPort\":4300", "\"webPort\":4300,\"webPort\":4300"));
        Reject(() => ViteServiceConfiguration.Parse(duplicate.RootElement));
        foreach (var session in new[] { null, "", new string('a', 42), new string('a', 44), new string('a', 42) + "=",
            new string('a', 42) + "\n", new string('a', 42) + "/", new string('a', 42) + "+", new string('a', 42) + "\u00e4" })
            Reject(() => ViteServiceConfiguration.RequireRuntimeSession(session));
        var syntheticSession = new string('a', 40) + "_Z-";
        var child = config.ChildEnvironment(syntheticSession);
        Check(child.Count == 13 && child[ViteServiceConfiguration.SessionEnvironment] == syntheticSession);
        Check(config.Environment.Count == 12 && !config.Environment.ContainsKey(ViteServiceConfiguration.SessionEnvironment));
        Check(config.Environment.All(pair => child[pair.Key] == pair.Value));
        Check(!JsonSerializer.Serialize(config).Contains(syntheticSession, StringComparison.Ordinal));
        Check(!child.ContainsKey("PATH") && !child.ContainsKey("HOME") && !child.ContainsKey("NODE_OPTIONS"));
        Reject(() => config.ChildEnvironment("invalid"));
    }

    private static void TestLayout()
    {
        using var document = Json(Configuration());
        var config = ViteServiceConfiguration.Parse(document.RootElement);
        config.ValidateLayout(); Check(true);
        foreach (var invalid in new[]
        {
            config with { NodeExecutable = @"C:\runtime\cmd.exe" }, config with { NodeExecutable = @"C:\runtime\..\node.exe" },
            config with { RepositoryRoot = @"\\server\share" }, config with { RepositoryRoot = config.RunRoot },
            config with { RepositoryRoot = config.RunRoot + @"\source" }, config with { RepositoryRoot = config.OsTempRoot },
            config with { RunRoot = @"C:\temp\eky-e2e\other" }, config with { RunRoot = @"D:\temp\eky-e2e\run-synthetic" },
            config with { ControlRoot = config.RunRoot }, config with { ControlRoot = config.RunRoot + @"-sibling\owner" },
            config with { ControlRoot = @"D:\temp\eky-e2e\run-synthetic\owner" }, config with { ControlRoot = config.ControlRoot + "." },
        }) Reject(invalid.ValidateLayout);
        foreach (var key in new[] { "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA" })
        foreach (var path in new[] { config.OsTempRoot, config.RunRoot + @"\temp", config.ControlRoot + @"\other",
            @"D:\temp\eky-e2e\run-synthetic\owner\temp", config.ControlRoot + @"\temp\..\temp" })
        {
            var env = new Dictionary<string, string>(config.Environment) { [key] = path };
            Reject((config with { Environment = env }).ValidateLayout);
        }
        foreach (var path in new[] { config.RunRoot + @"\temp", config.RunRoot + @"\worker\temp", config.ControlRoot + @"\temp" })
        {
            var env = new Dictionary<string, string>(config.Environment) { ["EKY_E2E_ENV_ROOT"] = path };
            (config with { Environment = env }).ValidateLayout(); Check(true);
        }
        foreach (var path in new[] { config.RunRoot, config.RunRoot + "\\", config.OsTempRoot,
            @"C:\temp\eky-e2e\run-other\temp", config.RunRoot + @"-sibling\temp", @"D:\temp\eky-e2e\run-synthetic\temp",
            config.RunRoot + @"\worker\..\temp", @"relative\temp" })
        {
            var env = new Dictionary<string, string>(config.Environment) { ["EKY_E2E_ENV_ROOT"] = path };
            Reject((config with { Environment = env }).ValidateLayout);
        }
        foreach (var pair in new[] { ("EKY_E2E", "0"), ("NODE_ENV", "production"),
            ("SystemRoot", "relative"), ("WINDIR", @"C:\Windows:stream"), ("EKY_E2E_OS_TEMP_ROOT", config.RunRoot) })
        {
            var env = new Dictionary<string, string>(config.Environment) { [pair.Item1] = pair.Item2 };
            Reject((config with { Environment = env }).ValidateLayout);
        }
        foreach (var origin in new[] { "http://localhost:4200", "http://127.0.0.2:4200", "http://[::1]:4200",
            "https://127.0.0.1:4200", "http://127.0.0.1", "http://127.0.0.1:80", "http://127.0.0.1:0", "http://127.0.0.1:65536",
            "http://127.0.0.1:4200/", "http://127.0.0.1:4200/path", "http://127.0.0.1:4200?x=1", "http://127.0.0.1:4200#fragment",
            "http://user@127.0.0.1:4200", " http://127.0.0.1:4200", "http://127.0.0.1:04200", "http://127.1:4200" })
            Reject(() => ViteServiceConfiguration.RequireBackendOrigin(origin));
        foreach (var origin in new[] { "http://127.0.0.1:1", "http://127.0.0.1:65535" })
        { ViteServiceConfiguration.RequireBackendOrigin(origin); Check(true); }
    }
}
