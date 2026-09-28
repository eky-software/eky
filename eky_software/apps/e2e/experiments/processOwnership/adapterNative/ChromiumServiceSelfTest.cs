using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// No browser, Job or child process is launched by these profile contracts.
internal static class ChromiumServiceSelfTest
{
    private static int checks;
    private static void Check(bool value) { checks++; if (!value) throw new AdapterFailure("chromiumSelfTestFailed"); }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (Exception error) when (error is AdapterFailure or InvalidOperationException or KeyNotFoundException or JsonException)
        { checks++; return; }
        throw new AdapterFailure("chromiumSelfTestFailed");
    }
    private static Dictionary<string, object?> Configuration() => new()
    {
        ["protocol"] = ChromiumServiceConfiguration.Protocol, ["schemaVersion"] = 1,
        ["generation"] = new string('a', 64), ["launchNonce"] = new string('b', 64),
        ["nodeExecutable"] = @"C:\runtime\node.exe", ["browserExecutable"] = @"C:\cache\chromium-1234\chrome-win64\chrome.exe",
        ["repositoryRoot"] = @"C:\source", ["osTempRoot"] = @"C:\temp", ["runRoot"] = @"C:\temp\eky-e2e\run-synthetic",
        ["controlRoot"] = @"C:\temp\eky-e2e\run-synthetic\owner", ["workBudgetMilliseconds"] = 60000,
        ["environment"] = new Dictionary<string, string>
        {
            ["EKY_E2E"] = "1", ["NODE_ENV"] = "test", ["SystemRoot"] = @"C:\Windows", ["WINDIR"] = @"C:\Windows",
            ["EKY_E2E_OS_TEMP_ROOT"] = @"C:\temp", ["TEMP"] = @"C:\temp\eky-e2e\run-synthetic\owner\temp",
            ["TMP"] = @"C:\temp\eky-e2e\run-synthetic\owner\temp", ["USERPROFILE"] = @"C:\temp\eky-e2e\run-synthetic\owner\profile",
            ["APPDATA"] = @"C:\temp\eky-e2e\run-synthetic\owner\profile", ["LOCALAPPDATA"] = @"C:\temp\eky-e2e\run-synthetic\owner\profile",
        },
    };
    private static ChromiumServiceConfiguration Parse(Dictionary<string, object?> value)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(value));
        return ChromiumServiceConfiguration.Parse(doc.RootElement);
    }

    internal static int Run()
    {
        var passed = false;
        try
        {
            if (!OperatingSystem.IsWindows() || Environment.GetEnvironmentVariable("EKY_E2E") != "1")
                throw new AdapterFailure("chromiumSelfTestFailed");
            var config = Parse(Configuration());
            config.ValidateLayout(); Check(true);
            Check(config.Arguments.SequenceEqual([@"C:\source\apps\e2e\src\environment\ownedChromiumServer.mjs", config.ConfigurationPath]));
            Check(config.ChildEnvironment["PLAYWRIGHT_BROWSERS_PATH"] == @"C:\cache");
            Check(!config.ChildEnvironment.ContainsKey("DEBUG") && !config.ChildEnvironment.ContainsKey("NODE_OPTIONS"));
            Check(config.ChildEnvironment.Count == 11 && config.Environment.Count == 10);
            Check(ServiceConfiguration.Protocol(ServiceProfile.Chromium) == ChromiumServiceConfiguration.Protocol);
            foreach (var key in Configuration().Keys)
            {
                var value = Configuration(); value.Remove(key); Reject(() => Parse(value));
            }
            foreach (var key in new[] { "args", "cwd", "endpoint", "entrypoint", "runtimeConfigPath", "cleanupBudgetMilliseconds" })
            {
                var value = Configuration(); value[key] = "rejected"; Reject(() => Parse(value));
            }
            foreach (var key in config.Environment.Keys)
            {
                var value = Configuration(); ((Dictionary<string, string>)value["environment"]!).Remove(key); Reject(() => Parse(value));
            }
            foreach (var key in new[] { "DEBUG", "PWDEBUG", "PATH", "NODE_OPTIONS", "PLAYWRIGHT_BROWSERS_PATH", "EKY_E2E_RUNTIME_SESSION" })
            {
                var value = Configuration(); ((Dictionary<string, string>)value["environment"]!)[key] = "rejected"; Reject(() => Parse(value));
            }
            foreach (var budget in new object?[] { null, 0, -1, 1.5, "60000", (long)int.MaxValue + 1 })
            {
                var value = Configuration(); value["workBudgetMilliseconds"] = budget; Reject(() => Parse(value));
            }
            foreach (var bad in new[]
            {
                config with { NodeExecutable = @"C:\runtime\cmd.exe" },
                config with { BrowserExecutable = @"C:\runtime\chrome.exe" },
                config with { ControlRoot = config.RunRoot },
                config with { RepositoryRoot = config.RunRoot },
                config with { RunRoot = @"C:\temp\eky-e2e\other" },
                config with { BrowserExecutable = @"\\server\share\chrome-win64\chrome.exe" },
            }) Reject(bad.ValidateLayout);
            foreach (var key in new[] { "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA" })
            {
                var changed = new Dictionary<string, string>(config.Environment) { [key] = @"C:\other" };
                Reject((config with { Environment = changed }).ValidateLayout);
            }
            using var request = JsonDocument.Parse(JsonSerializer.Serialize(new {
                protocol = ChromiumServiceConfiguration.Protocol, schemaVersion = 1, generation = config.Generation,
                sequence = 1, kind = "launch", launchNonce = config.LaunchNonce, workDeadlineElapsedMilliseconds = 45000,
            }));
            Check(BackendServiceProtocol.Request(request.RootElement, config.Generation, config.LaunchNonce, 0, ServiceProfile.Chromium).Kind == "launch");
            Reject(() => BackendServiceProtocol.Request(request.RootElement, config.Generation, config.LaunchNonce, 0, ServiceProfile.Vite));
            Reject(() => BackendServiceProtocol.Request(request.RootElement, config.Generation, config.LaunchNonce, 1, ServiceProfile.Chromium));
            passed = true;
        }
        catch { }
        Console.WriteLine(JsonSerializer.Serialize(new {
            protocol = ChromiumServiceConfiguration.Protocol, schemaVersion = 1, kind = "selfTest", passed, checks,
        }));
        return passed ? 0 : 1;
    }
}
