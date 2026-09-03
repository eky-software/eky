using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.WindowsProcessSupervisor;

internal sealed record WorkerTerminalResultValidation(
    bool IsSuccessful,
    string ResultCode
);

internal static partial class WorkerTerminalResultReader
{
    private const int MaximumResultBytes = 64 * 1024;
    private static readonly string[] ExpectedKeys =
    [
        "schemaVersion",
        "runNonce",
        "scenario",
        "artifactDescriptorSha256",
        "status",
        "resultCode",
        "errorCode",
    ];

    [GeneratedRegex("^[a-z][A-Za-z0-9]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeCodePattern();

    internal static WorkerTerminalResultValidation Validate(
        SupervisorRequest request
    )
    {
        if (!File.Exists(request.WorkerResultPath))
        {
            return new(false, "workerResultMissing");
        }

        try
        {
            var attributes = File.GetAttributes(request.WorkerResultPath);
            if (
                attributes.HasFlag(FileAttributes.Directory) ||
                attributes.HasFlag(FileAttributes.ReparsePoint)
            )
            {
                return new(false, "workerResultInvalid");
            }

            var file = new FileInfo(request.WorkerResultPath);
            if (file.Length is < 2 or > MaximumResultBytes)
            {
                return new(false, "workerResultInvalid");
            }

            using var stream = new FileStream(
                request.WorkerResultPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                4096,
                FileOptions.SequentialScan
            );
            using var document = JsonDocument.Parse(stream, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 4,
            });
            var root = document.RootElement;
            if (
                root.ValueKind != JsonValueKind.Object ||
                !HasExactKeys(root) ||
                !root.GetProperty("schemaVersion").TryGetInt32(out var schemaVersion) ||
                schemaVersion != 1
            )
            {
                return new(false, "workerResultInvalid");
            }

            var runNonce = ReadString(root, "runNonce");
            var scenario = ReadString(root, "scenario");
            var artifactDescriptorSha256 = ReadString(
                root,
                "artifactDescriptorSha256"
            );
            if (
                !string.Equals(runNonce, request.RunNonce, StringComparison.Ordinal) ||
                !string.Equals(scenario, request.Scenario, StringComparison.Ordinal) ||
                !string.Equals(
                    artifactDescriptorSha256,
                    request.ArtifactDescriptorSha256,
                    StringComparison.Ordinal
                )
            )
            {
                return new(false, "workerResultBindingInvalid");
            }

            var status = ReadString(root, "status");
            var resultCode = ReadString(root, "resultCode");
            var errorCode = ReadNullableString(root, "errorCode");
            if (
                !SafeCodePattern().IsMatch(resultCode) ||
                (errorCode is not null && !SafeCodePattern().IsMatch(errorCode))
            )
            {
                return new(false, "workerResultInvalid");
            }
            if (
                string.Equals(status, "completed", StringComparison.Ordinal) &&
                errorCode is null
            )
            {
                return new(true, "workerResultValidated");
            }
            if (
                string.Equals(status, "failed", StringComparison.Ordinal) &&
                errorCode is not null
            )
            {
                return new(false, "workerReportedFailure");
            }
            return new(false, "workerResultInvalid");
        }
        catch
        {
            return new(false, "workerResultInvalid");
        }
    }

    private static bool HasExactKeys(JsonElement root)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
            if (!keys.Add(property.Name))
            {
                return false;
            }
        }
        return keys.Count == ExpectedKeys.Length &&
            ExpectedKeys.All(keys.Contains);
    }

    private static string ReadString(JsonElement root, string key)
    {
        var value = root.GetProperty(key);
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new JsonException();
        }
        return value.GetString() ?? throw new JsonException();
    }

    private static string? ReadNullableString(JsonElement root, string key)
    {
        var value = root.GetProperty(key);
        if (value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new JsonException();
        }
        return value.GetString() ?? throw new JsonException();
    }
}
