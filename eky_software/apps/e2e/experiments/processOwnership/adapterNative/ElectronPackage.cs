using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.ProcessOwnershipAdapter;

// Only the named desktop Electron selector may be a link, never its parents or target.
internal sealed record ElectronPackage(string DirectoryPath, string Version, string DesktopManifestSha256,
    string ManifestSha256, string PathFileSha256, string ApplicationManifestSha256)
{
    private const int MaximumManifestBytes = 65536;
    private const string ApplicationMain = "e2e/electronE2eEntrypoint.js";
    internal string Executable => Path.Combine(DirectoryPath, "dist", "electron.exe");

    internal static ElectronPackage Read(string repositoryRoot)
    {
        var desktop = Path.Combine(repositoryRoot, "apps", "desktop");
        var desktopBytes = ReadFile(Path.Combine(desktop, "package.json"), MaximumManifestBytes);
        var version = ParseDesktopVersion(desktopBytes);
        var applicationDirectory = Path.Combine(desktop, "e2e-dist");
        var applicationBytes = ReadFile(Path.Combine(applicationDirectory, "package.json"), MaximumManifestBytes);
        ValidateApplicationManifest(applicationBytes);
        BackendServiceConfiguration.RequireCanonicalPath(
            Path.Combine(applicationDirectory, ApplicationMain.Replace('/', Path.DirectorySeparatorChar)), false);
        var parent = Path.Combine(desktop, "node_modules");
        BackendServiceConfiguration.RequireCanonicalPath(parent, true);
        var selector = new DirectoryInfo(Path.Combine(parent, "electron"));
        if (!selector.Attributes.HasFlag(FileAttributes.Directory) || !selector.Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new AdapterFailure("pathInvalid");
        var target = selector.ResolveLinkTarget(false)?.FullName ?? throw new AdapterFailure("pathInvalid");
        ValidateTarget(repositoryRoot, target, version);
        BackendServiceConfiguration.RequireCanonicalPath(target, true);
        var manifestBytes = ReadFile(Path.Combine(target, "package.json"), MaximumManifestBytes);
        ValidateManifest(manifestBytes, version);
        var pathBytes = ReadFile(Path.Combine(target, "path.txt"), 128);
        ValidatePathFile(pathBytes);
        var package = new ElectronPackage(target, version, Hash(desktopBytes), Hash(manifestBytes), Hash(pathBytes), Hash(applicationBytes));
        BackendServiceConfiguration.RequireCanonicalPath(package.Executable, false);
        return package;
    }

    internal static string ParseDesktopVersion(byte[] bytes)
    {
        using var document = ParseManifest(bytes);
        var dependencies = document.RootElement.GetProperty("devDependencies");
        RequireUniqueObject(dependencies);
        var version = AdapterProtocol.Text(dependencies, "electron", 64);
        RequireVersion(version);
        return version;
    }

    private static void RequireVersion(string version)
    {
        if (!Regex.IsMatch(version, @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z"))
            throw new AdapterFailure("configurationInvalid");
    }

    internal static void ValidateTarget(string repositoryRoot, string target, string version)
    {
        RequireVersion(version);
        BackendServiceConfiguration.RequireCanonicalSyntax(repositoryRoot);
        BackendServiceConfiguration.RequireCanonicalSyntax(target);
        if (!AdapterConfiguration.SamePath(target,
            Path.Combine(repositoryRoot, "node_modules", ".pnpm", "electron@" + version, "node_modules", "electron")))
            throw new AdapterFailure("pathInvalid");
    }

    internal static void ValidateManifest(byte[] bytes, string version)
    {
        RequireVersion(version);
        using var document = ParseManifest(bytes);
        if (AdapterProtocol.Text(document.RootElement, "name", 64) != "electron" ||
            AdapterProtocol.Text(document.RootElement, "version", 64) != version)
            throw new AdapterFailure("configurationInvalid");
    }

    internal static void ValidateApplicationManifest(byte[] bytes)
    {
        using var document = ParseManifest(bytes);
        var value = document.RootElement;
        if (AdapterProtocol.Text(value, "name", 64) != "eky-desktop-e2e" ||
            AdapterProtocol.Text(value, "type", 16) != "module" ||
            AdapterProtocol.Text(value, "main", 128) != ApplicationMain)
            throw new AdapterFailure("configurationInvalid");
    }

    internal static void ValidatePathFile(byte[] bytes)
    {
        if (bytes.Length is < 1 or > 128 || new UTF8Encoding(false, true).GetString(bytes).Trim() != "electron.exe")
            throw new AdapterFailure("configurationInvalid");
    }

    private static JsonDocument ParseManifest(byte[] bytes)
    {
        if (bytes.Length is < 2 or > MaximumManifestBytes) throw new AdapterFailure("configurationInvalid");
        var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 12 });
        try { RequireUniqueObject(document.RootElement); return document; }
        catch { document.Dispose(); throw; }
    }

    private static void RequireUniqueObject(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object ||
            value.EnumerateObject().Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() != value.EnumerateObject().Count())
            throw new AdapterFailure("configurationInvalid");
    }

    internal static byte[] ReadFile(string path, int maximumBytes)
    {
        BackendServiceConfiguration.RequireCanonicalPath(path, false);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length is < 1 || file.Length > maximumBytes) throw new AdapterFailure("configurationInvalid");
        var bytes = new byte[checked((int)file.Length)];
        file.ReadExactly(bytes);
        return bytes;
    }

    internal static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    internal void RequireUnchanged(ElectronPackage current)
    {
        if (!AdapterConfiguration.SamePath(DirectoryPath, current.DirectoryPath) || Version != current.Version ||
            DesktopManifestSha256 != current.DesktopManifestSha256 || ManifestSha256 != current.ManifestSha256 ||
            PathFileSha256 != current.PathFileSha256 || ApplicationManifestSha256 != current.ApplicationManifestSha256)
            throw new AdapterFailure("pathInvalid");
    }
}
