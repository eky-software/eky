using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.WindowsProcessSupervisor;

internal sealed record SupervisorRequest(
    string RequestPath,
    string ResultPath,
    string WorkerResultPath,
    string RunNonce,
    string Scenario,
    string ArtifactDescriptorSha256,
    string Command,
    IReadOnlyList<string> Arguments,
    string WorkingDirectory,
    int TimeoutMilliseconds,
    int CleanupReserveMilliseconds
);

internal sealed record SupervisorOutcome(
    string Status,
    string ProcessResultCode,
    string WorkerResultCode,
    string CleanupResultCode,
    bool ProcessTreeAbsent,
    int? ChildExitCode,
    int? ProcessWin32ErrorCode,
    int? CleanupWin32ErrorCode
)
{
    internal static SupervisorOutcome Completed(int childExitCode) =>
        new(
            "completed",
            "processCompleted",
            "workerResultValidated",
            "notRequired",
            true,
            childExitCode,
            null,
            null
        );

    internal static SupervisorOutcome Failed(
        string processResultCode,
        string cleanupResultCode,
        bool processTreeAbsent,
        int? childExitCode = null,
        string workerResultCode = "notChecked",
        int? processWin32ErrorCode = null,
        int? cleanupWin32ErrorCode = null
    ) => new(
        "failed",
        processResultCode,
        workerResultCode,
        cleanupResultCode,
        processTreeAbsent,
        childExitCode,
        processWin32ErrorCode,
        cleanupWin32ErrorCode
    );

    internal static SupervisorOutcome UnverifiedFailure(SupervisorFailure failure) =>
        Failed(
            failure.ErrorCode,
            "cleanupUnverified",
            false,
            processWin32ErrorCode: failure.Win32ErrorCode
        );
}

internal sealed class SupervisorFailure(
    string errorCode,
    int? win32ErrorCode = null
) : Exception(errorCode)
{
    internal string ErrorCode { get; } = errorCode;
    internal int? Win32ErrorCode { get; } = win32ErrorCode;
}

internal static partial class SupervisorRequestReader
{
    private const int MaximumRequestBytes = 1024 * 1024;
    private static readonly string[] ExpectedKeys =
    [
        "schemaVersion",
        "runNonce",
        "scenario",
        "artifactDescriptorSha256",
        "command",
        "arguments",
        "workingDirectory",
        "timeoutMilliseconds",
        "cleanupReserveMilliseconds",
    ];

    [GeneratedRegex("^[a-z][A-Za-z0-9]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex ScenarioPattern();

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();

    internal static SupervisorRequest Read(string[] arguments)
    {
        if (
            arguments.Length != 2 ||
            !string.Equals(arguments[0], "--request", StringComparison.Ordinal) ||
            !Path.IsPathFullyQualified(arguments[1])
        )
        {
            throw new SupervisorFailure("requestArgumentsInvalid");
        }

        var requestPath = Path.GetFullPath(arguments[1]);
        RequireRegularFile(requestPath);
        var file = new FileInfo(requestPath);
        if (file.Length is < 2 or > MaximumRequestBytes)
        {
            throw new SupervisorFailure("requestFileInvalid");
        }

        JsonDocument document;
        try
        {
            using var stream = new FileStream(
                requestPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                4096,
                FileOptions.SequentialScan
            );
            document = JsonDocument.Parse(stream, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8,
            });
        }
        catch
        {
            throw new SupervisorFailure("requestFileInvalid");
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new SupervisorFailure("requestSchemaInvalid");
            }
            RequireExactKeys(document.RootElement);

            var schemaVersion = RequireInteger(document.RootElement, "schemaVersion");
            var runNonce = RequireString(document.RootElement, "runNonce");
            var scenario = RequireString(document.RootElement, "scenario");
            var artifactDescriptorSha256 = RequireString(
                document.RootElement,
                "artifactDescriptorSha256"
            );
            var command = RequireString(document.RootElement, "command");
            var workingDirectory = RequireString(document.RootElement, "workingDirectory");
            var timeoutMilliseconds = RequireInteger(
                document.RootElement,
                "timeoutMilliseconds"
            );
            var cleanupReserveMilliseconds = RequireInteger(
                document.RootElement,
                "cleanupReserveMilliseconds"
            );
            var childArguments = RequireArguments(document.RootElement);

            if (
                schemaVersion != 1 ||
                !Sha256Pattern().IsMatch(runNonce) ||
                !ScenarioPattern().IsMatch(scenario) ||
                !Sha256Pattern().IsMatch(artifactDescriptorSha256)
            )
            {
                throw new SupervisorFailure("requestSchemaInvalid");
            }
            if (
                !Path.IsPathFullyQualified(command) ||
                !string.Equals(Path.GetExtension(command), ".exe", StringComparison.OrdinalIgnoreCase)
            )
            {
                throw new SupervisorFailure("requestCommandInvalid");
            }
            command = Path.GetFullPath(command);
            RequireRegularFile(command);

            if (!Path.IsPathFullyQualified(workingDirectory))
            {
                throw new SupervisorFailure("requestWorkingDirectoryInvalid");
            }
            workingDirectory = Path.GetFullPath(workingDirectory);
            RequireRegularDirectory(workingDirectory);

            if (
                timeoutMilliseconds is < 200 or > 14_400_000 ||
                cleanupReserveMilliseconds is < 50 or > 120_000 ||
                cleanupReserveMilliseconds >= timeoutMilliseconds
            )
            {
                throw new SupervisorFailure("requestTimeoutInvalid");
            }

            var resultPath = Path.Combine(
                Path.GetDirectoryName(requestPath)!,
                "result.json"
            );
            var workerResultPath = Path.Combine(
                Path.GetDirectoryName(requestPath)!,
                "worker-result.json"
            );
            if (
                File.Exists(resultPath) ||
                Directory.Exists(resultPath) ||
                File.Exists(workerResultPath) ||
                Directory.Exists(workerResultPath)
            )
            {
                throw new SupervisorFailure("resultPathOccupied");
            }

            return new SupervisorRequest(
                requestPath,
                resultPath,
                workerResultPath,
                runNonce,
                scenario,
                artifactDescriptorSha256,
                command,
                childArguments,
                workingDirectory,
                timeoutMilliseconds,
                cleanupReserveMilliseconds
            );
        }
    }

    private static void RequireExactKeys(JsonElement root)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
            if (!keys.Add(property.Name))
            {
                throw new SupervisorFailure("requestSchemaInvalid");
            }
        }
        if (keys.Count != ExpectedKeys.Length || ExpectedKeys.Any(key => !keys.Contains(key)))
        {
            throw new SupervisorFailure("requestSchemaInvalid");
        }
    }

    private static int RequireInteger(JsonElement root, string key)
    {
        if (!root.GetProperty(key).TryGetInt32(out var value))
        {
            throw new SupervisorFailure("requestSchemaInvalid");
        }
        return value;
    }

    private static string RequireString(JsonElement root, string key)
    {
        if (root.GetProperty(key).ValueKind != JsonValueKind.String)
        {
            throw new SupervisorFailure("requestSchemaInvalid");
        }
        var value = root.GetProperty(key).GetString();
        if (string.IsNullOrEmpty(value) || value.Contains('\0', StringComparison.Ordinal))
        {
            throw new SupervisorFailure("requestSchemaInvalid");
        }
        return value;
    }

    private static IReadOnlyList<string> RequireArguments(JsonElement root)
    {
        var element = root.GetProperty("arguments");
        if (element.ValueKind != JsonValueKind.Array)
        {
            throw new SupervisorFailure("requestSchemaInvalid");
        }

        var result = new List<string>();
        var totalLength = 0;
        foreach (var argument in element.EnumerateArray())
        {
            if (argument.ValueKind != JsonValueKind.String)
            {
                throw new SupervisorFailure("requestSchemaInvalid");
            }
            var value = argument.GetString()!;
            if (value.Contains('\0', StringComparison.Ordinal) || value.Length > 8192)
            {
                throw new SupervisorFailure("requestSchemaInvalid");
            }
            result.Add(value);
            totalLength += value.Length;
        }
        if (result.Count > 256 || totalLength > 30_000)
        {
            throw new SupervisorFailure("requestSchemaInvalid");
        }
        return result.AsReadOnly();
    }

    private static void RequireRegularFile(string path)
    {
        try
        {
            var attributes = File.GetAttributes(path);
            if (
                attributes.HasFlag(FileAttributes.Directory) ||
                attributes.HasFlag(FileAttributes.ReparsePoint)
            )
            {
                throw new SupervisorFailure("requestFileInvalid");
            }
        }
        catch (SupervisorFailure)
        {
            throw;
        }
        catch
        {
            throw new SupervisorFailure("requestFileInvalid");
        }
    }

    private static void RequireRegularDirectory(string path)
    {
        try
        {
            var attributes = File.GetAttributes(path);
            if (
                !attributes.HasFlag(FileAttributes.Directory) ||
                attributes.HasFlag(FileAttributes.ReparsePoint)
            )
            {
                throw new SupervisorFailure("requestWorkingDirectoryInvalid");
            }
        }
        catch (SupervisorFailure)
        {
            throw;
        }
        catch
        {
            throw new SupervisorFailure("requestWorkingDirectoryInvalid");
        }
    }
}
