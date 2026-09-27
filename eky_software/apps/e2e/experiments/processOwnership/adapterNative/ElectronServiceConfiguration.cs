using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record ElectronServiceConfiguration(string Generation, string LaunchNonce, string ElectronExecutable,
    string RepositoryRoot, string OsTempRoot, string RunRoot, string ControlRoot, string RuntimeConfigPath, string RuntimeRoot,
    IReadOnlyDictionary<string, string> Environment, int WorkBudgetMilliseconds, ServiceProfile Profile = ServiceProfile.Electron)
{
    internal const string Protocol = "eky.e2e.electron-service";
    private const int MaximumBytes = 8192;
    // The existing Electron E2E config reader owns its schema and the same size ceiling.
    private const int MaximumRuntimeConfigBytes = 32 * 1024;
    private static readonly string[] RequiredEnvironment = ["EKY_E2E", "NODE_ENV", "EKY_ELECTRON_E2E_CONFIG",
        "EKY_ELECTRON_E2E_RUN_ROOT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot", "WINDIR"];
    private ElectronPackage? preparedPackage;
    private string? configurationHash;
    private string? runtimeConfigHash;
    private bool IsBridge { get { RequireProfile(Profile); return Profile == ServiceProfile.ElectronBridge; } }
    internal string PipeName => IsBridge ? ElectronBridgeServiceProtocol.PipePrefix + Generation : $"eky-e2e-electron-v1-{Generation}";
    internal string ConfigurationPath => Path.Combine(ControlRoot, IsBridge
        ? ElectronBridgeServiceProtocol.ConfigurationFileName : "electron-service-config.json");
    internal string TerminalPath => Path.Combine(ControlRoot, IsBridge
        ? ElectronBridgeServiceProtocol.TerminalFileName : "electron-service-terminal.json");
    internal string Entrypoint => Path.Combine(RepositoryRoot, "apps", "desktop", "e2e-dist");
    internal string[] Arguments => [Entrypoint];

    internal static void RequireGuard()
    {
        if (!OperatingSystem.IsWindows() || System.Environment.GetEnvironmentVariable("EKY_E2E") != "1")
            throw new AdapterFailure("electronGuardFailed");
    }

    private static void RequireProfile(ServiceProfile profile)
    {
        if (profile is not (ServiceProfile.Electron or ServiceProfile.ElectronBridge)) throw new AdapterFailure("configurationInvalid");
    }

    internal static ElectronServiceConfiguration Read(string path, ServiceProfile profile = ServiceProfile.Electron)
    {
        RequireProfile(profile);
        RequireGuard();
        var bytes = ElectronPackage.ReadFile(path, MaximumBytes);
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
        var config = Parse(document.RootElement, profile);
        if (!AdapterConfiguration.SamePath(path, config.ConfigurationPath)) throw new AdapterFailure("configurationInvalid");
        config.configurationHash = ElectronPackage.Hash(bytes);
        config.ValidatePaths();
        if (File.Exists(config.TerminalPath) || File.Exists(config.TerminalPath + ".pending"))
            throw new AdapterFailure("configurationInvalid");
        return config;
    }

    internal static ElectronServiceConfiguration Parse(JsonElement value, ServiceProfile profile = ServiceProfile.Electron)
    {
        RequireProfile(profile);
        AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "electronExecutable",
            "repositoryRoot", "osTempRoot", "runRoot", "controlRoot", "runtimeConfigPath", "runtimeRoot", "environment", "workBudgetMilliseconds");
        var generation = AdapterProtocol.Token(value, "generation");
        BackendServiceProtocol.Identity(value, generation, profile);
        if (!value.GetProperty("workBudgetMilliseconds").TryGetInt32(out var budget) || budget < 1)
            throw new AdapterFailure("configurationInvalid");
        var environment = AdapterConfiguration.EnvironmentMap(value.GetProperty("environment"));
        ValidateEnvironmentKeys(environment);
        return new(generation, AdapterProtocol.Token(value, "launchNonce"),
            AdapterProtocol.Text(value, "electronExecutable", 1024), AdapterProtocol.Text(value, "repositoryRoot", 1024),
            AdapterProtocol.Text(value, "osTempRoot", 1024), AdapterProtocol.Text(value, "runRoot", 1024),
            AdapterProtocol.Text(value, "controlRoot", 1024), AdapterProtocol.Text(value, "runtimeConfigPath", 1024),
            AdapterProtocol.Text(value, "runtimeRoot", 1024), environment, budget, profile);
    }

    internal static void ValidateEnvironmentKeys(IReadOnlyDictionary<string, string> environment)
    {
        if (RequiredEnvironment.Any(key => !environment.ContainsKey(key)) ||
            environment.Keys.Any(key => !RequiredEnvironment.Contains(key, StringComparer.Ordinal) && key != "PATH") ||
            environment["EKY_E2E"] != "1" || environment["NODE_ENV"] != "test") throw new AdapterFailure("environmentInvalid");
    }

    internal void ValidateLayout()
    {
        RequireProfile(Profile);
        foreach (var path in new[] { ElectronExecutable, RepositoryRoot, OsTempRoot, RunRoot, ControlRoot, RuntimeConfigPath, RuntimeRoot })
            BackendServiceConfiguration.RequireCanonicalSyntax(path);
        if (!AdapterConfiguration.SamePath(Path.GetDirectoryName(RunRoot)!, Path.Combine(OsTempRoot, "eky-e2e")) ||
            !Path.GetFileName(RunRoot).StartsWith("run-", StringComparison.Ordinal) ||
            !AdapterConfiguration.IsWithin(ControlRoot, RunRoot) || !AdapterConfiguration.IsWithin(RuntimeRoot, RunRoot) ||
            AdapterConfiguration.SamePath(ControlRoot, RuntimeRoot) || AdapterConfiguration.IsWithin(ControlRoot, RuntimeRoot) ||
            AdapterConfiguration.IsWithin(RuntimeRoot, ControlRoot) ||
            !AdapterConfiguration.SamePath(RuntimeConfigPath, Path.Combine(RuntimeRoot, "electron-config.json")) ||
            AdapterConfiguration.SamePath(RepositoryRoot, RunRoot) || AdapterConfiguration.IsWithin(RunRoot, RepositoryRoot) ||
            AdapterConfiguration.IsWithin(RepositoryRoot, RunRoot)) throw new AdapterFailure("pathInvalid");
        ValidateEnvironmentKeys(Environment);
        var profile = Path.Combine(RuntimeRoot, "windows-profile");
        foreach (var key in RequiredEnvironment.Where(key => key is not ("EKY_E2E" or "NODE_ENV")))
        {
            BackendServiceConfiguration.RequireCanonicalSyntax(Environment[key]);
            var expected = key switch
            {
                "EKY_ELECTRON_E2E_CONFIG" => RuntimeConfigPath,
                "EKY_ELECTRON_E2E_RUN_ROOT" => RuntimeRoot,
                "HOME" or "USERPROFILE" => profile,
                "APPDATA" => Path.Combine(profile, "AppData", "Roaming"),
                "LOCALAPPDATA" => Path.Combine(profile, "AppData", "Local"),
                "TEMP" or "TMP" => Path.Combine(profile, "Temp"),
                _ => Environment[key],
            };
            if (!AdapterConfiguration.SamePath(Environment[key], expected)) throw new AdapterFailure("environmentInvalid");
        }
    }

    internal void ValidatePaths()
    {
        RequireGuard();
        ValidateLayout();
        var anchor = System.Environment.GetEnvironmentVariable("EKY_E2E_OS_TEMP_ROOT") ?? throw new AdapterFailure("environmentInvalid");
        BackendServiceConfiguration.RequireCanonicalPath(anchor, true);
        if (!AdapterConfiguration.SamePath(anchor, OsTempRoot)) throw new AdapterFailure("environmentInvalid");
        foreach (var directory in new[] { RepositoryRoot, OsTempRoot, RunRoot, ControlRoot, RuntimeRoot, Entrypoint })
            BackendServiceConfiguration.RequireCanonicalPath(directory, true);
        BackendServiceConfiguration.RequireCanonicalPath(ElectronExecutable, false);
        foreach (var key in RequiredEnvironment.Where(key => key is not ("EKY_E2E" or "NODE_ENV" or "EKY_ELECTRON_E2E_CONFIG")))
            BackendServiceConfiguration.RequireCanonicalPath(Environment[key], true);
        var current = ElectronPackage.Read(RepositoryRoot);
        if (!AdapterConfiguration.SamePath(ElectronExecutable, current.Executable)) throw new AdapterFailure("pathInvalid");
        if (preparedPackage is not null) preparedPackage.RequireUnchanged(current);
        var ownerHash = ElectronPackage.Hash(ElectronPackage.ReadFile(ConfigurationPath, MaximumBytes));
        var runtimeHash = ElectronPackage.Hash(ElectronPackage.ReadFile(RuntimeConfigPath, MaximumRuntimeConfigBytes));
        if ((configurationHash is not null && configurationHash != ownerHash) ||
            (runtimeConfigHash is not null && runtimeConfigHash != runtimeHash)) throw new AdapterFailure("configurationInvalid");
        preparedPackage = current;
        configurationHash ??= ownerHash;
        runtimeConfigHash ??= runtimeHash;
    }
}
