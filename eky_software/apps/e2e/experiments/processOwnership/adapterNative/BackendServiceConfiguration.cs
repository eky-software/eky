using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record BackendServiceConfiguration(string Generation, string LaunchNonce, string NodeExecutable,
    string RepositoryRoot, string OsTempRoot, string RunRoot, string ControlRoot, string RuntimeConfigPath,
    IReadOnlyDictionary<string, string> Environment, int WorkBudgetMilliseconds)
{
    internal string PipeName => $"eky-e2e-backend-v1-{Generation}";
    internal string Entrypoint => Path.Combine(RepositoryRoot, "apps", "backend", "e2e-dist", "e2e", "backendEntrypoint.js");
    internal string ConfigurationPath => Path.Combine(ControlRoot, "backend-service-config.json");
    internal string TerminalPath => Path.Combine(ControlRoot, "backend-service-terminal.json");
    private const int MaximumBytes = 8192;
    private const string OsTempRootEnvironment = "EKY_E2E_OS_TEMP_ROOT";
    private static readonly string[] RequiredEnvironment = ["EKY_E2E", "NODE_ENV", "SystemRoot", "WINDIR", "TEMP", "TMP",
        "USERPROFILE", "APPDATA", "LOCALAPPDATA", OsTempRootEnvironment];
    private static readonly string[] WritableEnvironment = ["TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"];

    internal static void RequireGuard()
    {
        if (!OperatingSystem.IsWindows() || System.Environment.GetEnvironmentVariable("EKY_E2E") != "1")
            throw new AdapterFailure("backendGuardFailed");
    }

    internal static BackendServiceConfiguration Read(string path)
    {
        RequireGuard();
        RequireCanonicalPath(path, false);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length is < 2 or > MaximumBytes) throw new AdapterFailure("configurationInvalid");
        using var document = JsonDocument.Parse(file, new JsonDocumentOptions { MaxDepth = 4 });
        var config = Parse(document.RootElement);
        if (!AdapterConfiguration.SamePath(path, config.ConfigurationPath)) throw new AdapterFailure("configurationInvalid");
        config.ValidatePaths();
        if (File.Exists(config.TerminalPath) || File.Exists(config.TerminalPath + ".pending"))
            throw new AdapterFailure("configurationInvalid");
        return config;
    }

    internal static BackendServiceConfiguration Parse(JsonElement value)
    {
        AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "nodeExecutable",
            "repositoryRoot", "osTempRoot", "runRoot", "controlRoot", "runtimeConfigPath", "environment", "workBudgetMilliseconds");
        var generation = AdapterProtocol.Token(value, "generation");
        BackendServiceProtocol.Identity(value, generation);
        if (!value.GetProperty("workBudgetMilliseconds").TryGetInt32(out var budget) || budget < 1)
            throw new AdapterFailure("configurationInvalid");
        var environment = AdapterConfiguration.EnvironmentMap(value.GetProperty("environment"));
        ValidateEnvironmentKeys(environment);
        return new(generation, AdapterProtocol.Token(value, "launchNonce"),
            AdapterProtocol.Text(value, "nodeExecutable", 1024), AdapterProtocol.Text(value, "repositoryRoot", 1024),
            AdapterProtocol.Text(value, "osTempRoot", 1024), AdapterProtocol.Text(value, "runRoot", 1024),
            AdapterProtocol.Text(value, "controlRoot", 1024), AdapterProtocol.Text(value, "runtimeConfigPath", 1024), environment, budget);
    }

    internal static void ValidateEnvironmentKeys(IReadOnlyDictionary<string, string> environment)
    {
        if (RequiredEnvironment.Any(key => !environment.ContainsKey(key)) ||
            environment.Keys.Any(key => !RequiredEnvironment.Contains(key, StringComparer.Ordinal) && key != "HOME") ||
            environment["EKY_E2E"] != "1" || environment["NODE_ENV"] != "test") throw new AdapterFailure("environmentInvalid");
    }

    internal void ValidatePaths()
    {
        foreach (var directory in new[] { RepositoryRoot, OsTempRoot, RunRoot, ControlRoot }) RequireCanonicalPath(directory, true);
        foreach (var file in new[] { NodeExecutable, Entrypoint, RuntimeConfigPath, ConfigurationPath }) RequireCanonicalPath(file, false);
        ValidateLayout();
        RequireCanonicalPath(Environment[OsTempRootEnvironment], true);
        foreach (var key in WritableEnvironment)
            if (Environment.TryGetValue(key, out var path)) RequireCanonicalPath(path, true);
        foreach (var key in new[] { "SystemRoot", "WINDIR" }) RequireCanonicalPath(Environment[key], true);
    }

    internal void ValidateLayout()
    {
        foreach (var path in new[] { NodeExecutable, Entrypoint, RepositoryRoot, OsTempRoot, RunRoot, ControlRoot, RuntimeConfigPath })
            RequireCanonicalSyntax(path);
        if (!string.Equals(Path.GetFileName(NodeExecutable), "node.exe", StringComparison.OrdinalIgnoreCase) ||
            !AdapterConfiguration.SamePath(Path.GetDirectoryName(RunRoot)!, Path.Combine(OsTempRoot, "eky-e2e")) ||
            !Path.GetFileName(RunRoot).StartsWith("run-", StringComparison.Ordinal) ||
            !AdapterConfiguration.IsWithin(ControlRoot, RunRoot) || !AdapterConfiguration.IsWithin(RuntimeConfigPath, RunRoot) ||
            AdapterConfiguration.IsWithin(RuntimeConfigPath, ControlRoot) ||
            AdapterConfiguration.SamePath(RepositoryRoot, RunRoot) || AdapterConfiguration.IsWithin(RunRoot, RepositoryRoot) ||
            AdapterConfiguration.IsWithin(RepositoryRoot, RunRoot)) throw new AdapterFailure("pathInvalid");
        ValidateEnvironmentKeys(Environment);
        RequireCanonicalSyntax(Environment[OsTempRootEnvironment]);
        if (!AdapterConfiguration.SamePath(Environment[OsTempRootEnvironment], OsTempRoot))
            throw new AdapterFailure("environmentInvalid");
        foreach (var key in WritableEnvironment)
        {
            if (!Environment.TryGetValue(key, out var path)) continue;
            RequireCanonicalSyntax(path);
            if (!AdapterConfiguration.IsWithin(path, RunRoot)) throw new AdapterFailure("environmentInvalid");
        }
        foreach (var key in new[] { "SystemRoot", "WINDIR" }) RequireCanonicalSyntax(Environment[key]);
    }

    internal static void RequireCanonicalPath(string path, bool directory)
    {
        RequireCanonicalSyntax(path);
        AdapterConfiguration.RequirePath(path, directory);
    }

    internal static void RequireCanonicalSyntax(string path)
    {
        if (path.Length < 3 || !char.IsAsciiLetter(path[0]) || path[1] != ':' || path[2] != '\\' || path.IndexOf(':', 2) >= 0 ||
            !string.Equals(Path.TrimEndingDirectorySeparator(path), Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)),
                StringComparison.OrdinalIgnoreCase) || path.Contains('/') ||
            path.Split('\\').Skip(1).Any(part => part.EndsWith('.') || part.EndsWith(' '))) throw new AdapterFailure("pathInvalid");
    }

    internal void WriteTerminal(BackendServiceSnapshot state, long cleanupStarted, Action requireDeadline)
        => ServiceConfiguration.WriteTerminal(ServiceProfile.Backend, Generation, ControlRoot, TerminalPath,
            state, cleanupStarted, requireDeadline);
}
