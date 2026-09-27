using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class ViteServiceSelfTest
{
    private const string PackageRoot = @"C:\source\node_modules\.pnpm\vite@8.2.1_@types+node@24.13.3\node_modules\vite";
    private static Dictionary<string, object?> Manifest() => new()
    { ["name"] = "vite", ["version"] = "8.2.1", ["bin"] = new { vite = "bin/vite.js" }, ["type"] = "module" };

    private static void TestPackage()
    {
        VitePackage.ValidateTarget(@"C:\source", PackageRoot); Check(true);
        foreach (var target in new[]
        {
            PackageRoot.Replace(@"C:\source", @"D:\source", StringComparison.Ordinal),
            PackageRoot.Replace(@"C:\source", @"C:\source-other", StringComparison.Ordinal),
            @"C:\source\apps\web\node_modules\vite", PackageRoot + @"\child", PackageRoot + "-other",
            PackageRoot.Replace("vite@8.2.1", "other@8.2.1", StringComparison.Ordinal),
            PackageRoot.Replace(".pnpm", ".pnpm-other", StringComparison.Ordinal),
            PackageRoot.Replace(@"\node_modules\vite", @"\other\vite", StringComparison.Ordinal),
            PackageRoot + @"\..\vite", PackageRoot + ":stream", PackageRoot + ".", @"\\server\share\vite",
        }) Reject(() => VitePackage.ValidateTarget(@"C:\source", target));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(Manifest());
        var package = VitePackage.ParseManifest(PackageRoot, bytes);
        Check(package.Version == "8.2.1" && package.Entrypoint == PackageRoot + @"\bin\vite.js" && package.ManifestSha256.Length == 64);
        Check(package.Arguments(4300).SequenceEqual(new[] { package.Entrypoint, "--config", "vite.config.ts", "--configLoader", "runner",
            "--host", "127.0.0.1", "--port", "4300", "--strictPort", "--mode", "eky-e2e" }));
        Reject(() => package.Arguments(0)); Reject(() => package.Arguments(65536));
        package.RequireUnchanged(VitePackage.ParseManifest(PackageRoot, bytes)); Check(true);
        Reject(() => package.RequireUnchanged(package with { DirectoryPath = PackageRoot.Replace("24.13.3", "24.13.4", StringComparison.Ordinal) }));
        Reject(() => package.RequireUnchanged(package with { Version = "8.2.2" }));
        Reject(() => package.RequireUnchanged(package with { ManifestSha256 = new string('0', 64) }));
        Reject(() => VitePackage.ParseManifest(PackageRoot.Replace("8.2.1", "8.2.10", StringComparison.Ordinal), bytes));
        foreach (var change in new Action<Dictionary<string, object?>>[]
        {
            value => value["name"] = "other", value => value.Remove("name"), value => value["name"] = 1,
            value => value["version"] = "8.2.2", value => value.Remove("version"), value => value["version"] = "../8.2.1",
            value => value["bin"] = "bin/vite.js", value => value["bin"] = new { vite = "bin/other.js" },
            value => value["bin"] = new { vite = "../outside.js" }, value => value["bin"] = new { vite = @"C:\outside.js" },
            value => value["bin"] = new { vite = "bin/vite.js", other = "bin/other.js" }, value => value.Remove("bin"),
        })
        {
            var values = Manifest(); change(values);
            Reject(() => VitePackage.ParseManifest(PackageRoot, JsonSerializer.SerializeToUtf8Bytes(values)));
        }
        foreach (var invalid in new[]
        {
            Encoding.UTF8.GetBytes("[]"), Encoding.UTF8.GetBytes("{"), new byte[65537],
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(Manifest()).Replace("\"name\":\"vite\"", "\"name\":\"other\",\"name\":\"vite\"")),
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(Manifest()).Replace("\"vite\":\"bin/vite.js\"", "\"vite\":\"bin/vite.js\",\"vite\":\"bin/vite.js\"")),
        }) Reject(() => VitePackage.ParseManifest(PackageRoot, invalid));
        var changed = Manifest(); changed["description"] = "same identity but changed manifest";
        Reject(() => package.RequireUnchanged(VitePackage.ParseManifest(PackageRoot, JsonSerializer.SerializeToUtf8Bytes(changed))));
    }

    private static void TestTerminalPublication()
    {
        var temp = Path.TrimEndingDirectorySeparator(Path.GetTempPath());
        BackendServiceConfiguration.RequireCanonicalPath(temp, true);
        var root = Path.Combine(temp, "eky-e2e", "run-vite-selftest-" + Guid.NewGuid().ToString("N"));
        if (Directory.Exists(root)) throw new AdapterFailure("viteSelfTestFailed");
        Directory.CreateDirectory(root);
        try
        {
            var state = new BackendServiceState();
            state.Fail("launchRejected"); state.BeginStop(); state.ObserveJob(0); state.SetStdioSettled(true);
            var terminal = state.Freeze(true);
            var path = Path.Combine(root, "vite-service-terminal.json");
            var deadlineChecks = 0;
            ServiceConfiguration.WriteTerminal(ServiceProfile.Vite, Generation, root, path, terminal, 1250, () => deadlineChecks++);
            Check(deadlineChecks == 3 && File.Exists(path) && !File.Exists(path + ".pending"));
            var bytes = File.ReadAllBytes(path);
            using var receipt = JsonDocument.Parse(bytes);
            AdapterProtocol.ExactKeys(receipt.RootElement, "protocol", "schemaVersion", "generation", "kind", "state", "cleanupStartedElapsedMilliseconds");
            BackendServiceProtocol.Identity(receipt.RootElement, Generation, ServiceProfile.Vite);
            Check(receipt.RootElement.GetProperty("kind").GetString() == "terminal" &&
                receipt.RootElement.GetProperty("cleanupStartedElapsedMilliseconds").GetInt64() == 1250);
            Check(receipt.RootElement.GetProperty("state").GetProperty("firstFailure").GetString() == "launchRejected" &&
                receipt.RootElement.GetProperty("state").GetProperty("cleanup").GetString() == "processTreeAbsent");
            Reject(() => BackendServiceProtocol.Identity(receipt.RootElement, Generation));
            try
            {
                ServiceConfiguration.WriteTerminal(ServiceProfile.Vite, Generation, root, path, terminal, 1250, () => { });
                throw new AdapterFailure("viteSelfTestFailed");
            }
            catch (IOException) { Check(File.ReadAllBytes(path).SequenceEqual(bytes)); }
            var expired = Path.Combine(root, "expired.json");
            Reject(() => ServiceConfiguration.WriteTerminal(ServiceProfile.Vite, Generation, root, expired, terminal, 1250,
                () => throw new AdapterFailure("cleanupDeadlineExceeded")));
            Check(!File.Exists(expired) && !File.Exists(expired + ".pending"));
            var late = Path.Combine(root, "late.json");
            var calls = 0;
            Reject(() => ServiceConfiguration.WriteTerminal(ServiceProfile.Vite, Generation, root, late, terminal, 1250,
                () => { if (++calls == 2) throw new AdapterFailure("cleanupDeadlineExceeded"); }));
            Check(!File.Exists(late) && File.Exists(late + ".pending"));
            var backend = Path.Combine(root, "backend-service-terminal.json");
            ServiceConfiguration.WriteTerminal(ServiceProfile.Backend, Generation, root, backend, terminal, 1250, () => { });
            Check(File.ReadAllText(backend) == Encoding.UTF8.GetString(bytes)
                .Replace(ViteServiceConfiguration.Protocol, BackendServiceProtocol.Name, StringComparison.Ordinal));
        }
        finally
        {
            BackendServiceConfiguration.RequireCanonicalPath(root, true);
            Directory.Delete(root, true);
        }
    }
}
