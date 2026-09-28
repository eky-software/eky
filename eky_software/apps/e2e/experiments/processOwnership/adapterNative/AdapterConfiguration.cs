using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record AdapterConfiguration(string Generation, string LaunchNonce, string Electron, string Cwd,
    string TempRoot, IReadOnlyDictionary<string, string> Environment)
{
    internal string PipeName(string suffix) => $"eky-t3c-{Generation}-{suffix}";

    internal static AdapterConfiguration Read(string path)
    {
        if (!OperatingSystem.IsWindows() || System.Environment.GetEnvironmentVariable("EKY_E2E") != "1")
            AdapterProtocol.Fail("experimentGuardFailed");
        RequirePath(path, false);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length is < 2 or > 8192) AdapterProtocol.Fail("configurationInvalid");
        using var document = JsonDocument.Parse(file, new JsonDocumentOptions { MaxDepth = 4 });
        var value = document.RootElement;
        AdapterProtocol.ExactKeys(value, "schemaVersion", "generation", "launchNonce", "electron", "cwd", "tempRoot", "environment");
        var generation = AdapterProtocol.Token(value, "generation");
        AdapterProtocol.Identity(value, generation);
        var nonce = AdapterProtocol.Token(value, "launchNonce");
        var electron = AdapterProtocol.Text(value, "electron", 1024);
        var cwd = AdapterProtocol.Text(value, "cwd", 1024);
        var root = AdapterProtocol.Text(value, "tempRoot", 1024);
        RequirePath(electron, false);
        RequirePath(cwd, true);
        RequirePath(root, true);
        // The outer T3a owner binds the original OS temp base before redirecting TEMP/TMP.
        var tempBase = System.Environment.GetEnvironmentVariable("EKY_T3A_TEMP_BASE") ??
            System.Environment.GetEnvironmentVariable("EKY_T3C_TEMP_BASE") ?? Path.GetTempPath();
        if (!SamePath(Path.GetDirectoryName(root)!, tempBase) ||
            !Path.GetFileName(root).StartsWith("eky-t3a-", StringComparison.Ordinal) ||
            !SamePath(Path.GetDirectoryName(cwd)!, root) ||
            !SamePath(Path.GetDirectoryName(path)!, cwd) ||
            !electron.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) AdapterProtocol.Fail("configurationInvalid");
        var environment = EnvironmentMap(value.GetProperty("environment"));
        if (!environment.TryGetValue("EKY_E2E", out var guard) || guard != "1") AdapterProtocol.Fail("environmentInvalid");
        foreach (var key in new[] { "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP" })
        {
            if (!environment.TryGetValue(key, out var directory) || !IsWithin(directory, cwd)) AdapterProtocol.Fail("environmentInvalid");
            RequirePath(directory, true);
        }
        if (environment.TryGetValue("HOME", out var home))
        {
            if (!IsWithin(home, cwd)) AdapterProtocol.Fail("environmentInvalid");
            RequirePath(home, true);
        }
        return new(generation, nonce, electron, Path.GetFullPath(cwd), Path.GetFullPath(root), environment);
    }

    internal static Dictionary<string, string> EnvironmentMap(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) AdapterProtocol.Fail("environmentInvalid");
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in value.EnumerateObject())
        {
            if (result.Count >= 48 || !Regex.IsMatch(property.Name, "\\A[A-Za-z_][A-Za-z0-9_]{0,63}\\z") ||
                property.Value.ValueKind != JsonValueKind.String) AdapterProtocol.Fail("environmentInvalid");
            var text = property.Value.GetString()!;
            if (text.Length > 2048 || text.Contains('\0') || !result.TryAdd(property.Name, text)) AdapterProtocol.Fail("environmentInvalid");
        }
        if (new[] { "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_SANDBOX" }.Any(result.ContainsKey))
            AdapterProtocol.Fail("environmentInvalid");
        return result;
    }

    internal static bool SamePath(string first, string second) => Path.IsPathFullyQualified(first) &&
        Path.IsPathFullyQualified(second) && string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(first)),
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(second)), StringComparison.OrdinalIgnoreCase);

    internal static bool IsWithin(string child, string parent) => Path.IsPathFullyQualified(child) &&
        Path.GetFullPath(child).StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent)) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase);

    internal static void RequirePath(string path, bool directory)
    {
        if (!Path.IsPathFullyQualified(path) || path.StartsWith("\\\\", StringComparison.Ordinal) ||
            path.IndexOf(':', 2) >= 0) AdapterProtocol.Fail("pathInvalid");
        var attributes = File.GetAttributes(path);
        if (attributes.HasFlag(FileAttributes.ReparsePoint) || attributes.HasFlag(FileAttributes.Directory) != directory)
            AdapterProtocol.Fail("pathInvalid");
        for (var cursor = new DirectoryInfo(directory ? path : Path.GetDirectoryName(path)!); cursor is not null; cursor = cursor.Parent)
            if (cursor.Attributes.HasFlag(FileAttributes.ReparsePoint)) AdapterProtocol.Fail("pathInvalid");
    }

    internal void WriteTerminal(AdapterSnapshot state)
    {
        RequirePath(Cwd, true);
        var pending = Path.Combine(Cwd, "adapter-terminal.json.pending");
        using (var file = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, new { schemaVersion = 1, generation = Generation, state }, AdapterProtocol.Json);
            file.Flush(true);
        }
        File.Move(pending, Path.Combine(Cwd, "adapter-terminal.json"), false);
    }
}
