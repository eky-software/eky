using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class ElectronServiceSelfTest
{
    private static byte[] DesktopManifest() => JsonSerializer.SerializeToUtf8Bytes(new { devDependencies = new { electron = Version } });
    private static byte[] PackageManifest() => JsonSerializer.SerializeToUtf8Bytes(new { name = "electron", version = Version });
    private static Dictionary<string, object?> ApplicationManifest() => new()
    {
        ["name"] = "eky-desktop-e2e", ["type"] = "module", ["main"] = "e2e/electronE2eEntrypoint.js",
        ["private"] = true, ["version"] = "0.0.0",
    };

    private static void TestPackage()
    {
        TestApplicationManifest();
        Check(ElectronPackage.ParseDesktopVersion(DesktopManifest()) == Version);
        ElectronPackage.ValidateTarget(@"C:\source", PackageRoot, Version); Check(true);
        ElectronPackage.ValidateManifest(PackageManifest(), Version); Check(true);
        foreach (var version in new object?[] { null, 43, "^43.0.0", "~43.0.0", "43", "43.0", "043.0.0", "43.00.0", "43.0.0-beta.1",
            "43.0.0+metadata", "43.0.0\n", "43.0.0/../other", "", "43.0.*" })
            Reject(() => ElectronPackage.ParseDesktopVersion(JsonSerializer.SerializeToUtf8Bytes(new { devDependencies = new { electron = version } })));
        foreach (var value in new object?[] { null, true, new[] { "electron" }, new { }, new { electron = Version } })
            Reject(() => ElectronPackage.ParseDesktopVersion(JsonSerializer.SerializeToUtf8Bytes(value)));
        foreach (var invalid in new[] { "[]", "{", "{}", "{\"devDependencies\":null}",
            "{\"devDependencies\":{\"electron\":\"43.0.0\",\"electron\":\"43.0.0\"}}",
            "{\"devDependencies\":{},\"devDependencies\":{\"electron\":\"43.0.0\"}}" })
            Reject(() => ElectronPackage.ParseDesktopVersion(Encoding.UTF8.GetBytes(invalid)));
        Reject(() => ElectronPackage.ParseDesktopVersion(new byte[65537]));
        foreach (var target in new[] { PackageRoot.Replace(@"C:\source", @"D:\source", StringComparison.Ordinal),
            PackageRoot.Replace(@"C:\source", @"C:\source-other", StringComparison.Ordinal),
            @"C:\source\apps\desktop\node_modules\electron", PackageRoot + @"\child", PackageRoot + "-other",
            PackageRoot.Replace("electron@43.0.0", "electron@43.0.1", StringComparison.Ordinal),
            PackageRoot.Replace("electron@43.0.0", "electron@43.0.0_peer", StringComparison.Ordinal),
            PackageRoot.Replace(".pnpm", ".pnpm-other", StringComparison.Ordinal), PackageRoot + @"\..\electron",
            PackageRoot + ":stream", PackageRoot + ".", @"\\server\share\electron" })
            Reject(() => ElectronPackage.ValidateTarget(@"C:\source", target, Version));
        foreach (var bytes in new[] { Encoding.UTF8.GetBytes("[]"), Encoding.UTF8.GetBytes("{"), new byte[65537],
            JsonSerializer.SerializeToUtf8Bytes(new { name = "other", version = Version }),
            JsonSerializer.SerializeToUtf8Bytes(new { name = "electron", version = "43.0.1" }),
            JsonSerializer.SerializeToUtf8Bytes(new { name = "electron", version = 43 }),
            Encoding.UTF8.GetBytes("{\"name\":\"electron\",\"name\":\"electron\",\"version\":\"43.0.0\"}"),
            Encoding.UTF8.GetBytes("{\"name\":\"electron\",\"version\":\"43.0.0\",\"version\":\"43.0.0\"}") })
            Reject(() => ElectronPackage.ValidateManifest(bytes, Version));
        foreach (var path in new[] { "electron.exe", "electron.exe\n", "electron.exe\r\n" })
        { ElectronPackage.ValidatePathFile(Encoding.UTF8.GetBytes(path)); Check(true); }
        foreach (var path in new[] { "", "Electron.exe", "node.exe", "../electron.exe", "dist/electron.exe", @"C:\electron.exe",
            "electron.exe\0", "electron.exe\nother", "electron.exe:stream", new string('x', 129) })
            Reject(() => ElectronPackage.ValidatePathFile(Encoding.UTF8.GetBytes(path)));
        Reject(() => ElectronPackage.ValidatePathFile([0xff]));
        var package = new ElectronPackage(PackageRoot, Version, new string('a', 64), new string('b', 64), new string('c', 64), new string('d', 64));
        Check(package.Executable == PackageRoot + @"\dist\electron.exe");
        package.RequireUnchanged(package with { }); Check(true);
        foreach (var changed in new[] { package with { DirectoryPath = PackageRoot + "-other" }, package with { Version = "43.0.1" },
            package with { DesktopManifestSha256 = new string('d', 64) }, package with { ManifestSha256 = new string('d', 64) },
            package with { PathFileSha256 = new string('d', 64) }, package with { ApplicationManifestSha256 = new string('e', 64) } })
            Reject(() => package.RequireUnchanged(changed));
    }

    private static void TestApplicationManifest()
    {
        ElectronPackage.ValidateApplicationManifest(JsonSerializer.SerializeToUtf8Bytes(ApplicationManifest())); Check(true);
        foreach (var key in new[] { "name", "type", "main" })
        {
            var missing = ApplicationManifest(); missing.Remove(key);
            Reject(() => ElectronPackage.ValidateApplicationManifest(JsonSerializer.SerializeToUtf8Bytes(missing)));
            foreach (var invalid in new object?[] { null, true, 1, new[] { "invalid" }, "", "invalid" })
            {
                var values = ApplicationManifest(); values[key] = invalid;
                Reject(() => ElectronPackage.ValidateApplicationManifest(JsonSerializer.SerializeToUtf8Bytes(values)));
            }
            var serialized = JsonSerializer.Serialize(ApplicationManifest());
            var field = JsonSerializer.Serialize(key) + ":" + JsonSerializer.Serialize(ApplicationManifest()[key]);
            Reject(() => ElectronPackage.ValidateApplicationManifest(Encoding.UTF8.GetBytes(serialized.Replace(field, field + "," + field))));
        }
        foreach (var pair in new[] { ("name", "eky-desktop"), ("type", "commonjs"), ("main", "../electronE2eEntrypoint.js"),
            ("main", "e2e/other.js"), ("main", @"e2e\electronE2eEntrypoint.js"), ("main", @"C:\outside.js"),
            ("main", "e2e/../e2e/electronE2eEntrypoint.js"), ("main", "e2e/electronE2eEntrypoint.js ") })
        {
            var values = ApplicationManifest(); values[pair.Item1] = pair.Item2;
            Reject(() => ElectronPackage.ValidateApplicationManifest(JsonSerializer.SerializeToUtf8Bytes(values)));
        }
        foreach (var bytes in new[] { Array.Empty<byte>(), new byte[65537], Encoding.UTF8.GetBytes("[]"),
            Encoding.UTF8.GetBytes("null"), Encoding.UTF8.GetBytes("{"),
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(ApplicationManifest()).Replace("\"private\":true", "\"private\":true,\"private\":true")) })
            Reject(() => ElectronPackage.ValidateApplicationManifest(bytes));
    }
}
