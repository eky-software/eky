using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Only the fixed web Vite selector may be a link. Its parents and target may not be.
internal sealed record VitePackage(string DirectoryPath, string Version, string ManifestSha256)
{
    private const int MaximumManifestBytes = 65536;
    internal string Entrypoint => Path.Combine(DirectoryPath, "bin", "vite.js");
    internal string[] Arguments(int port)
    {
        if (port is < 1 or > 65535) throw new AdapterFailure("configurationInvalid");
        return [Entrypoint, "--config", "vite.config.ts", "--configLoader", "runner", "--host", "127.0.0.1",
            "--port", port.ToString(CultureInfo.InvariantCulture), "--strictPort", "--mode", "eky-e2e"];
    }

    internal static VitePackage Read(string repositoryRoot)
    {
        var parent = Path.Combine(repositoryRoot, "apps", "web", "node_modules");
        BackendServiceConfiguration.RequireCanonicalPath(parent, true);
        var selector = new DirectoryInfo(Path.Combine(parent, "vite"));
        if (!selector.Attributes.HasFlag(FileAttributes.Directory) || !selector.Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new AdapterFailure("pathInvalid");
        // Do not silently follow a chain of reparses: validate the immediate target itself.
        var target = selector.ResolveLinkTarget(false)?.FullName ?? throw new AdapterFailure("pathInvalid");
        ValidateTarget(repositoryRoot, target);
        BackendServiceConfiguration.RequireCanonicalPath(target, true);
        var manifest = Path.Combine(target, "package.json");
        BackendServiceConfiguration.RequireCanonicalPath(manifest, false);
        using var file = new FileStream(manifest, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length is < 2 or > MaximumManifestBytes) throw new AdapterFailure("configurationInvalid");
        var bytes = new byte[checked((int)file.Length)];
        file.ReadExactly(bytes);
        var package = ParseManifest(target, bytes);
        BackendServiceConfiguration.RequireCanonicalPath(package.Entrypoint, false);
        return package;
    }

    internal static void ValidateTarget(string repositoryRoot, string target)
    {
        BackendServiceConfiguration.RequireCanonicalSyntax(repositoryRoot);
        BackendServiceConfiguration.RequireCanonicalSyntax(target);
        var store = Path.Combine(repositoryRoot, "node_modules", ".pnpm");
        var modules = Path.GetDirectoryName(target);
        var item = modules is null ? null : Path.GetDirectoryName(modules);
        if (item is null || !string.Equals(Path.GetFileName(target), "vite", StringComparison.Ordinal) ||
            !string.Equals(Path.GetFileName(modules), "node_modules", StringComparison.Ordinal) ||
            !AdapterConfiguration.SamePath(Path.GetDirectoryName(item)!, store) ||
            !Path.GetFileName(item).StartsWith("vite@", StringComparison.Ordinal)) throw new AdapterFailure("pathInvalid");
    }

    internal static VitePackage ParseManifest(string target, byte[] bytes)
    {
        if (bytes.Length is < 2 or > MaximumManifestBytes) throw new AdapterFailure("configurationInvalid");
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 12 });
        var value = document.RootElement;
        if (value.ValueKind != JsonValueKind.Object ||
            value.EnumerateObject().Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() != value.EnumerateObject().Count() ||
            AdapterProtocol.Text(value, "name", 64) != "vite") throw new AdapterFailure("configurationInvalid");
        var version = AdapterProtocol.Text(value, "version", 64);
        if (version.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('.' or '-' or '+')))
            throw new AdapterFailure("configurationInvalid");
        var bin = value.GetProperty("bin");
        AdapterProtocol.ExactKeys(bin, "vite");
        if (AdapterProtocol.Text(bin, "vite", 64) != "bin/vite.js") throw new AdapterFailure("configurationInvalid");
        var itemName = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(target))!);
        if (itemName != "vite@" + version && !itemName.StartsWith("vite@" + version + "_", StringComparison.Ordinal))
            throw new AdapterFailure("configurationInvalid");
        return new(target, version, Convert.ToHexStringLower(SHA256.HashData(bytes)));
    }

    internal void RequireUnchanged(VitePackage current)
    {
        if (!AdapterConfiguration.SamePath(DirectoryPath, current.DirectoryPath) || Version != current.Version ||
            ManifestSha256 != current.ManifestSha256) throw new AdapterFailure("pathInvalid");
    }
}
