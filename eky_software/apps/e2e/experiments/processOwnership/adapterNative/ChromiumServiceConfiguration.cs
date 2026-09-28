using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record ChromiumServiceConfiguration(string Generation, string LaunchNonce, string NodeExecutable,
    string RepositoryRoot, string OsTempRoot, string RunRoot, string ControlRoot, string BrowserExecutable,
    IReadOnlyDictionary<string, string> Environment, int WorkBudgetMilliseconds)
{
    internal const string Protocol = "eky.e2e.chromium-service";
    private static readonly string[] RequiredEnvironment = ["EKY_E2E", "NODE_ENV", "SystemRoot", "WINDIR",
        "EKY_E2E_OS_TEMP_ROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
    internal string PipeName => $"eky-e2e-chromium-v1-{Generation}";
    internal string ConfigurationPath => Path.Combine(ControlRoot, "chromium-service-config.json");
    internal string TerminalPath => Path.Combine(ControlRoot, "chromium-service-terminal.json");
    internal string Entrypoint => Path.Combine(RepositoryRoot, "apps", "e2e", "src", "environment", "ownedChromiumServer.mjs");
    internal string[] Arguments => [Entrypoint, ConfigurationPath];
    internal IReadOnlyDictionary<string, string> ChildEnvironment => new Dictionary<string, string>(Environment, StringComparer.OrdinalIgnoreCase)
    {
        // Keep Playwright's default headless-shell selection after HOME isolation.
        ["PLAYWRIGHT_BROWSERS_PATH"] = Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(BrowserExecutable)))!,
    };

    internal static ChromiumServiceConfiguration Read(string path)
    {
        if (!OperatingSystem.IsWindows() || System.Environment.GetEnvironmentVariable("EKY_E2E") != "1")
            throw new AdapterFailure("chromiumGuardFailed");
        BackendServiceConfiguration.RequireCanonicalPath(path, false);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length is < 2 or > 8192) throw new AdapterFailure("configurationInvalid");
        using var document = JsonDocument.Parse(file, new JsonDocumentOptions { MaxDepth = 4 });
        var config = Parse(document.RootElement);
        if (!AdapterConfiguration.SamePath(path, config.ConfigurationPath)) throw new AdapterFailure("configurationInvalid");
        config.ValidatePaths();
        foreach (var evidence in new[] { config.TerminalPath, config.TerminalPath + ".pending",
            Path.Combine(config.ControlRoot, "chromium-ready.json"), Path.Combine(config.ControlRoot, "chromium-ready.json.pending") })
            if (File.Exists(evidence) || Directory.Exists(evidence)) throw new AdapterFailure("configurationInvalid");
        return config;
    }

    internal static ChromiumServiceConfiguration Parse(JsonElement value)
    {
        AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "nodeExecutable",
            "repositoryRoot", "osTempRoot", "runRoot", "controlRoot", "browserExecutable", "environment", "workBudgetMilliseconds");
        var generation = AdapterProtocol.Token(value, "generation");
        BackendServiceProtocol.Identity(value, generation, ServiceProfile.Chromium);
        if (!value.GetProperty("workBudgetMilliseconds").TryGetInt32(out var budget) || budget < 1)
            throw new AdapterFailure("configurationInvalid");
        var environment = AdapterConfiguration.EnvironmentMap(value.GetProperty("environment"));
        ValidateEnvironment(environment);
        return new(generation, AdapterProtocol.Token(value, "launchNonce"),
            AdapterProtocol.Text(value, "nodeExecutable", 1024), AdapterProtocol.Text(value, "repositoryRoot", 1024),
            AdapterProtocol.Text(value, "osTempRoot", 1024), AdapterProtocol.Text(value, "runRoot", 1024),
            AdapterProtocol.Text(value, "controlRoot", 1024), AdapterProtocol.Text(value, "browserExecutable", 1024), environment, budget);
    }

    private static void ValidateEnvironment(IReadOnlyDictionary<string, string> environment)
    {
        if (environment.Count != RequiredEnvironment.Length || RequiredEnvironment.Any(key => !environment.ContainsKey(key)) ||
            environment.Keys.Any(key => !RequiredEnvironment.Contains(key, StringComparer.Ordinal)) ||
            environment["EKY_E2E"] != "1" || environment["NODE_ENV"] != "test") throw new AdapterFailure("environmentInvalid");
    }

    internal void ValidateLayout()
    {
        foreach (var path in new[] { NodeExecutable, BrowserExecutable, RepositoryRoot, OsTempRoot, RunRoot, ControlRoot })
            BackendServiceConfiguration.RequireCanonicalSyntax(path);
        if (!string.Equals(Path.GetFileName(NodeExecutable), "node.exe", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetFileName(BrowserExecutable), "chrome.exe", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetFileName(Path.GetDirectoryName(BrowserExecutable)), "chrome-win64", StringComparison.Ordinal) ||
            !AdapterConfiguration.SamePath(Path.GetDirectoryName(RunRoot)!, Path.Combine(OsTempRoot, "eky-e2e")) ||
            !Path.GetFileName(RunRoot).StartsWith("run-", StringComparison.Ordinal) ||
            !AdapterConfiguration.IsWithin(ControlRoot, RunRoot) ||
            AdapterConfiguration.SamePath(RepositoryRoot, RunRoot) || AdapterConfiguration.IsWithin(RunRoot, RepositoryRoot) ||
            AdapterConfiguration.IsWithin(RepositoryRoot, RunRoot)) throw new AdapterFailure("pathInvalid");
        ValidateEnvironment(Environment);
        foreach (var key in RequiredEnvironment.Where(key => key is not ("EKY_E2E" or "NODE_ENV")))
            BackendServiceConfiguration.RequireCanonicalSyntax(Environment[key]);
        if (!AdapterConfiguration.SamePath(Environment["EKY_E2E_OS_TEMP_ROOT"], OsTempRoot)) throw new AdapterFailure("environmentInvalid");
        foreach (var key in new[] { "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA" })
            if (!AdapterConfiguration.SamePath(Environment[key], Path.Combine(ControlRoot, key is "TEMP" or "TMP" ? "temp" : "profile")))
                throw new AdapterFailure("environmentInvalid");
    }

    internal void ValidatePaths()
    {
        ValidateLayout();
        foreach (var directory in new[] { RepositoryRoot, OsTempRoot, RunRoot, ControlRoot })
            BackendServiceConfiguration.RequireCanonicalPath(directory, true);
        foreach (var file in new[] { NodeExecutable, BrowserExecutable, Entrypoint, ConfigurationPath })
            BackendServiceConfiguration.RequireCanonicalPath(file, false);
        foreach (var key in RequiredEnvironment.Where(key => key is not ("EKY_E2E" or "NODE_ENV")))
            BackendServiceConfiguration.RequireCanonicalPath(Environment[key], true);
    }
}
