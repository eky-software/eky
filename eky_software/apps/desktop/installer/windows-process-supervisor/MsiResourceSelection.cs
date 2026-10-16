using System.Text;
using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

internal sealed record MsiResourceSelection(string Identity, string[] Files)
{
    internal static MsiResourceSelection? Read(SupervisorRequest request, Func<bool> admitted, string? fixtureRoot = null)
    {
        try
        {
            var contract = MsiWindowObservation.Contract;
            var directory = Path.GetDirectoryName(request.ResultPath)!;
            var path = Path.Combine(directory, contract.ResourceSelectionFilename);
            if (!admitted() || !RegularAncestors(directory) || !RegularFile(path)) return null;
            using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (input.Length is < 2 || input.Length > contract.MaximumSelectionBytes) return null;
            using var document = JsonDocument.Parse(input, new JsonDocumentOptions { MaxDepth = 8 });
            var value = document.RootElement;
            if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != 7 ||
                !value.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(new[] {
                    "artifactDescriptorSha256", "files", "root", "runNonce", "scenario", "schemaVersion", "selectionIdentity" }) ||
                value.GetProperty("schemaVersion").GetInt32() != 1 ||
                value.GetProperty("runNonce").GetString() != request.RunNonce ||
                value.GetProperty("scenario").GetString() != request.Scenario ||
                value.GetProperty("artifactDescriptorSha256").GetString() != request.ArtifactDescriptorSha256) return null;
            var identity = value.GetProperty("selectionIdentity").GetString()!;
            if (identity.Length != 64 || identity.Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f'))) return null;
            var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (fixtureRoot is null && string.IsNullOrEmpty(local)) return null;
            var root = Path.GetFullPath(fixtureRoot ?? Path.Combine(local!, "Programs", "Eky"));
            if (!string.Equals(value.GetProperty("root").GetString(), root, StringComparison.OrdinalIgnoreCase) ||
                !RegularAncestors(root)) return null;
            var entries = value.GetProperty("files");
            if (entries.ValueKind != JsonValueKind.Array || entries.GetArrayLength() is < 1 ||
                entries.GetArrayLength() > contract.MaximumResourceFiles) return null;
            var files = new List<string>();
            var unique = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in entries.EnumerateArray())
            {
                if (!admitted() || entry.ValueKind != JsonValueKind.String) return null;
                var relative = entry.GetString()!;
                if (Encoding.UTF8.GetByteCount(relative) > contract.MaximumResourcePathBytes ||
                    relative.Contains('\\') || relative.Contains(':') || relative.Split('/').Any(segment =>
                        segment is "" or "." or ".." || segment.EndsWith('.') || char.IsWhiteSpace(segment[^1]) ||
                        segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)) return null;
                var file = Path.GetFullPath(Path.Combine(root, relative));
                if (!file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                    !unique.Add(file) || !RegularAncestors(Path.GetDirectoryName(file)!) || !RegularFile(file)) return null;
                files.Add(file);
            }
            return admitted() ? new(identity, files.ToArray()) : null;
        }
        catch { return null; }
    }

    internal bool IsCurrent(Func<bool> admitted) => Files.All(file => admitted() &&
        RegularAncestors(Path.GetDirectoryName(file)!) && RegularFile(file));

    private static bool RegularFile(string path) =>
        (File.GetAttributes(path) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0;

    private static bool RegularAncestors(string directory)
    {
        for (var current = new DirectoryInfo(directory); current is not null; current = current.Parent)
            if ((current.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory) return false;
        return true;
    }
}
