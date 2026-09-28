using System.Globalization;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record ViteServiceConfiguration(string Generation, string LaunchNonce, string NodeExecutable,
    string RepositoryRoot, string OsTempRoot, string RunRoot, string ControlRoot, int WebPort,
    IReadOnlyDictionary<string, string> Environment, int WorkBudgetMilliseconds)
{
    internal const string Protocol = "eky.e2e.vite-service";
    internal const string SessionEnvironment = "EKY_E2E_RUNTIME_SESSION";
    private const int MaximumBytes = 8192;
    private static readonly string[] RequiredEnvironment = ["EKY_E2E", "NODE_ENV", "SystemRoot", "WINDIR",
        "EKY_E2E_OS_TEMP_ROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
        "EKY_E2E_BACKEND_ORIGIN", "EKY_E2E_ENV_ROOT"];
    private VitePackage? preparedPackage;
    internal string PipeName => $"eky-e2e-vite-v1-{Generation}";
    internal string ConfigurationPath => Path.Combine(ControlRoot, "vite-service-config.json");
    internal string TerminalPath => Path.Combine(ControlRoot, "vite-service-terminal.json");
    internal string WorkingDirectory => Path.Combine(RepositoryRoot, "apps", "web");
    internal string[] Arguments => (preparedPackage ?? throw new AdapterFailure("pathInvalid")).Arguments(WebPort);

    internal static void RequireGuard()
    {
        if (!OperatingSystem.IsWindows() || System.Environment.GetEnvironmentVariable("EKY_E2E") != "1")
            throw new AdapterFailure("viteGuardFailed");
    }

    internal static ViteServiceConfiguration Read(string path)
    {
        RequireGuard();
        BackendServiceConfiguration.RequireCanonicalPath(path, false);
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

    internal static ViteServiceConfiguration Parse(JsonElement value)
    {
        AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "nodeExecutable",
            "repositoryRoot", "osTempRoot", "runRoot", "controlRoot", "webPort", "environment", "workBudgetMilliseconds");
        var generation = AdapterProtocol.Token(value, "generation");
        BackendServiceProtocol.Identity(value, generation, ServiceProfile.Vite);
        if (!value.GetProperty("workBudgetMilliseconds").TryGetInt32(out var budget) || budget < 1 ||
            !value.GetProperty("webPort").TryGetInt32(out var port) || port is < 1 or > 65535)
            throw new AdapterFailure("configurationInvalid");
        var environment = AdapterConfiguration.EnvironmentMap(value.GetProperty("environment"));
        ValidateEnvironmentKeys(environment);
        return new(generation, AdapterProtocol.Token(value, "launchNonce"),
            AdapterProtocol.Text(value, "nodeExecutable", 1024), AdapterProtocol.Text(value, "repositoryRoot", 1024),
            AdapterProtocol.Text(value, "osTempRoot", 1024), AdapterProtocol.Text(value, "runRoot", 1024),
            AdapterProtocol.Text(value, "controlRoot", 1024), port, environment, budget);
    }

    internal static void ValidateEnvironmentKeys(IReadOnlyDictionary<string, string> environment)
    {
        if (environment.Count != RequiredEnvironment.Length || RequiredEnvironment.Any(key => !environment.ContainsKey(key)) ||
            environment.Keys.Any(key => !RequiredEnvironment.Contains(key, StringComparer.Ordinal)) ||
            environment["EKY_E2E"] != "1" || environment["NODE_ENV"] != "test") throw new AdapterFailure("environmentInvalid");
    }

    internal static string RequireRuntimeSession(string? value)
    {
        if (value is not { Length: 43 } || value.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('_' or '-')))
            throw new AdapterFailure("environmentInvalid");
        return value;
    }

    internal IReadOnlyDictionary<string, string> ChildEnvironment(string session)
    {
        ValidateEnvironmentKeys(Environment);
        var variables = new Dictionary<string, string>(Environment, StringComparer.OrdinalIgnoreCase)
        { [SessionEnvironment] = RequireRuntimeSession(session) };
        return variables;
    }

    internal void ValidateLayout()
    {
        foreach (var path in new[] { NodeExecutable, RepositoryRoot, OsTempRoot, RunRoot, ControlRoot })
            BackendServiceConfiguration.RequireCanonicalSyntax(path);
        if (!string.Equals(Path.GetFileName(NodeExecutable), "node.exe", StringComparison.OrdinalIgnoreCase) ||
            !AdapterConfiguration.SamePath(Path.GetDirectoryName(RunRoot)!, Path.Combine(OsTempRoot, "eky-e2e")) ||
            !Path.GetFileName(RunRoot).StartsWith("run-", StringComparison.Ordinal) ||
            !AdapterConfiguration.IsWithin(ControlRoot, RunRoot) ||
            AdapterConfiguration.SamePath(RepositoryRoot, RunRoot) || AdapterConfiguration.IsWithin(RunRoot, RepositoryRoot) ||
            AdapterConfiguration.IsWithin(RepositoryRoot, RunRoot)) throw new AdapterFailure("pathInvalid");
        ValidateEnvironmentKeys(Environment);
        foreach (var key in new[] { "SystemRoot", "WINDIR", "EKY_E2E_OS_TEMP_ROOT" })
            BackendServiceConfiguration.RequireCanonicalSyntax(Environment[key]);
        if (!AdapterConfiguration.SamePath(Environment["EKY_E2E_OS_TEMP_ROOT"], OsTempRoot))
            throw new AdapterFailure("environmentInvalid");
        foreach (var key in new[] { "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA" })
        {
            BackendServiceConfiguration.RequireCanonicalSyntax(Environment[key]);
            var directory = key is "TEMP" or "TMP" ? "temp" : "profile";
            if (!AdapterConfiguration.SamePath(Environment[key], Path.Combine(ControlRoot, directory)))
                throw new AdapterFailure("environmentInvalid");
        }
        var environmentRoot = Environment["EKY_E2E_ENV_ROOT"];
        BackendServiceConfiguration.RequireCanonicalSyntax(environmentRoot);
        if (AdapterConfiguration.SamePath(environmentRoot, RunRoot) || !AdapterConfiguration.IsWithin(environmentRoot, RunRoot))
            throw new AdapterFailure("environmentInvalid");
        RequireBackendOrigin(Environment["EKY_E2E_BACKEND_ORIGIN"]);
    }

    internal static void RequireBackendOrigin(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1" ||
            uri.IsDefaultPort || uri.Port is < 1 or > 65535 ||
            value != "http://127.0.0.1:" + uri.Port.ToString(CultureInfo.InvariantCulture))
            throw new AdapterFailure("environmentInvalid");
    }

    internal void ValidatePaths()
    {
        ValidateLayout();
        foreach (var directory in new[] { RepositoryRoot, OsTempRoot, RunRoot, ControlRoot, WorkingDirectory })
            BackendServiceConfiguration.RequireCanonicalPath(directory, true);
        foreach (var file in new[] { NodeExecutable, ConfigurationPath, Path.Combine(WorkingDirectory, "vite.config.ts") })
            BackendServiceConfiguration.RequireCanonicalPath(file, false);
        foreach (var key in RequiredEnvironment.Where(key => key is not ("EKY_E2E" or "NODE_ENV" or "EKY_E2E_BACKEND_ORIGIN")))
            BackendServiceConfiguration.RequireCanonicalPath(Environment[key], true);
        var current = VitePackage.Read(RepositoryRoot);
        if (preparedPackage is not null) preparedPackage.RequireUnchanged(current);
        preparedPackage = current;
    }
}
