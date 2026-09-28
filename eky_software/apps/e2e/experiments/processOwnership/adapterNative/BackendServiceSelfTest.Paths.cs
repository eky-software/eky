namespace Eky.ProcessOwnershipAdapter;

internal static partial class BackendServiceSelfTest
{
    private static void TestPaths()
    {
        using var document = Json(Configuration());
        var config = BackendServiceConfiguration.Parse(document.RootElement);
        config.ValidateLayout();
        Check(config.RuntimeConfigPath.EndsWith(@"bootstrap\config.json", StringComparison.Ordinal));
        foreach (var path in new[] { @"relative\node.exe", @"C:node.exe", @"\\server\share\node.exe", @"\\?\C:\node.exe",
            @"C:\runtime\node.exe:stream", @"C:\runtime\..\node.exe", @"C:\runtime\node.exe.", @"C:\runtime \node.exe", "C:/node.exe" })
            Reject(() => BackendServiceConfiguration.RequireCanonicalSyntax(path));
        foreach (var invalid in new[]
        {
            config with { NodeExecutable = @"C:\runtime\cmd.exe" },
            config with { RunRoot = @"C:\temp\eky-e2e\other" },
            config with { RunRoot = @"C:\other\eky-e2e\run-synthetic" },
            config with { ControlRoot = config.RunRoot },
            config with { ControlRoot = @"C:\outside\owner" },
            config with { RuntimeConfigPath = @"C:\outside\config.json" },
            config with { RuntimeConfigPath = Path.Combine(config.ControlRoot, "runtime-config.json") },
            config with { RuntimeConfigPath = config.RunRoot + @"-prefix\config.json" },
            config with { RepositoryRoot = config.RunRoot },
            config with { RepositoryRoot = Path.Combine(config.RunRoot, "source") },
        }) Reject(invalid.ValidateLayout);
        foreach (var key in new[] { "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME" })
        {
            var environment = new Dictionary<string, string>(config.Environment) { [key] = @"C:\outside" };
            Reject((config with { Environment = environment }).ValidateLayout);
        }
        foreach (var value in new[] { "", "relative-temp", @"C:temp", @"C:\other", @"C:\temp\..\temp", config.RunRoot })
        {
            var environment = new Dictionary<string, string>(config.Environment) { ["EKY_E2E_OS_TEMP_ROOT"] = value };
            Reject((config with { Environment = environment }).ValidateLayout);
        }
        foreach (var key in new[] { "TEMP", "TMP" })
        {
            var environment = new Dictionary<string, string>(config.Environment) { [key] = config.OsTempRoot };
            Reject((config with { Environment = environment }).ValidateLayout);
        }
        foreach (var value in new[] { @"C:\runtime", @".\bin", @"C:\runtime;relative", @"C:\runtime;", "" })
        {
            var environment = new Dictionary<string, string>(config.Environment) { ["PATH"] = value };
            Reject((config with { Environment = environment }).ValidateLayout);
        }
        var scoped = new Dictionary<string, string>(config.Environment)
        {
            ["TEMP"] = Path.Combine(config.ControlRoot, "temp"), ["TMP"] = Path.Combine(config.ControlRoot, "temp"),
            ["USERPROFILE"] = Path.Combine(config.ControlRoot, "profile"), ["APPDATA"] = Path.Combine(config.ControlRoot, "profile"),
            ["LOCALAPPDATA"] = Path.Combine(config.ControlRoot, "profile"),
            ["HOME"] = Path.Combine(config.ControlRoot, "profile"),
        };
        (config with { Environment = scoped }).ValidateLayout();
        Check(!scoped.ContainsKey("PATH") && scoped["EKY_E2E_OS_TEMP_ROOT"] == config.OsTempRoot &&
            scoped["TEMP"] != config.OsTempRoot && scoped["TMP"] != config.OsTempRoot);
        (config with { RuntimeConfigPath = Path.Combine(config.RunRoot, "runtime-config.json") }).ValidateLayout();
        Check(true);
    }
}
