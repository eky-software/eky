using System.Text.Json;
using System.Security.Cryptography;

namespace Eky.WindowsProcessSupervisor;

// Private build-time projection of existing TS owners, not a launch capability.
internal sealed record SourceBootstrapProjection(string ProofSwitch, string TokenEnvironment,
    string MarkerFilename, string DirectoryName, int PathTokenLength, string UserDataRelative,
    string WorkspaceRunRootPrefix, IReadOnlyList<string> FaultScenarios)
{
    private const int MaximumProjectionBytes = 16 * 1024;
    private static readonly string[] Keys = ["schemaVersion", "sourceOwners", "proofSwitch", "tokenEnvironment",
        "markerFilename", "directoryName", "pathTokenLength", "userDataRelative", "workspaceRunRootPrefix", "faultScenarios"];

    internal static SourceBootstrapProjection Read() => Read(out _);

    internal static SourceBootstrapProjection Read(out string sha256)
    {
        using var stream = typeof(SourceBootstrapProjection).Assembly
            .GetManifestResourceStream("source-bootstrap-projection.private.json")
            ?? throw Invalid();
        if (stream.Length is < 2 or > MaximumProjectionBytes) throw Invalid();
        var bytes = new byte[(int)stream.Length];
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw Invalid();
        sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes));
        return Parse(bytes);
    }

    internal static SourceBootstrapProjection Parse(byte[] bytes)
    {
        try
        {
            if (bytes.Length is < 2 or > MaximumProjectionBytes) throw Invalid();
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            ExactKeys(root, Keys);
            if (root.GetProperty("schemaVersion").GetInt32() != 1) throw Invalid();
            string Text(string name)
            {
                var value = root.GetProperty(name).GetString();
                if (value is null || value.Length is < 1 or > 128 || value.Contains('\0')) throw Invalid();
                return value;
            }
            var owners = root.GetProperty("sourceOwners");
            if (owners.ValueKind != JsonValueKind.Array || owners.GetArrayLength() != 2) throw Invalid();
            var ownerPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var owner in owners.EnumerateArray())
            {
                ExactKeys(owner, ["path", "sha256"]);
                var path = owner.GetProperty("path").GetString();
                var digest = owner.GetProperty("sha256").GetString();
                if (path is null || path.Length is < 1 or > 256 || !path.StartsWith("apps/desktop/", StringComparison.Ordinal) ||
                    path.Contains('\0') || path.Contains('\\') || path.Split('/').Any(part => part is "" or "." or "..") ||
                    !ownerPaths.Add(path) || digest is null || !Hex(digest, 64)) throw Invalid();
            }
            var tokenLength = root.GetProperty("pathTokenLength").GetInt32();
            if (tokenLength is < 1 or > 64) throw Invalid();
            var proofSwitch = Text("proofSwitch");
            var tokenEnvironment = Text("tokenEnvironment");
            var marker = Text("markerFilename");
            var directory = Text("directoryName");
            var userData = Text("userDataRelative");
            var prefix = Text("workspaceRunRootPrefix");
            if (!Segment(proofSwitch) || !Segment(marker) || !Segment(directory) || !Segment(userData) || !Segment(prefix) ||
                !char.IsAsciiLetter(tokenEnvironment[0]) || tokenEnvironment.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '_'))
                throw Invalid();
            var scenarios = root.GetProperty("faultScenarios");
            if (scenarios.ValueKind != JsonValueKind.Array || scenarios.GetArrayLength() is < 1 or > 32) throw Invalid();
            var names = scenarios.EnumerateArray().Select(item => item.GetString()).ToArray();
            if (names.Any(name => name is null || name.Length is < 1 or > 64 || !name.All(char.IsAsciiLetterOrDigit)) ||
                names.Distinct(StringComparer.Ordinal).Count() != names.Length) throw Invalid();
            return new(proofSwitch, tokenEnvironment, marker, directory, tokenLength, userData, prefix,
                Array.AsReadOnly(names.Select(name => name!).ToArray()));
        }
        catch (SupervisorFailure) { throw; }
        catch { throw Invalid(); }
    }

    internal (string ProofRoot, string UserDataPath) Derive(string canonicalTemporaryRoot, string nonce)
    {
        if (!Path.IsPathFullyQualified(canonicalTemporaryRoot) || canonicalTemporaryRoot.Contains('\0') ||
            !string.Equals(Path.GetFullPath(canonicalTemporaryRoot), canonicalTemporaryRoot, StringComparison.OrdinalIgnoreCase) ||
            !Hex(nonce, 64)) throw Invalid();
        var root = Path.Combine(canonicalTemporaryRoot, DirectoryName, nonce[..PathTokenLength]);
        return (root, Path.Combine(root, UserDataRelative));
    }

    private static bool Segment(string value) => value is not "." and not ".." &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-' or '.');
    private static bool Hex(string value, int length) => value.Length == length &&
        value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static void ExactKeys(JsonElement value, IReadOnlyCollection<string> expected)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid();
        var names = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (names.Length != expected.Count || names.Distinct(StringComparer.Ordinal).Count() != names.Length ||
            names.Any(name => !expected.Contains(name, StringComparer.Ordinal))) throw Invalid();
    }
    private static SupervisorFailure Invalid() => new("processStateInvalid");
}
