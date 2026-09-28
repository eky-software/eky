using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.ProcessOwnershipAdapter;

// Pre-exit drain evidence only. The intended code is NOT an observed process exit.
internal static class BridgeDrainCompletion
{
    internal const string FileName = "adapter-bridge-drain.private.json";
    internal const int MaximumBytes = 1024;
    private const int BeforeReadyExitCode = 29;

    internal static byte[] Encode(string generation, int intendedExitCode)
    {
        if (!Regex.IsMatch(generation, "\\A[0-9a-f]{64}\\z", RegexOptions.CultureInvariant) ||
            intendedExitCode is not (0 or BeforeReadyExitCode or AdapterProtocol.BridgeTestExitCode))
            throw new AdapterFailure("frameInvalid");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new
        { schemaVersion = AdapterProtocol.SchemaVersion, generation, kind = "drainCompleted", intendedExitCode });
        if (bytes.Length > MaximumBytes) throw new AdapterFailure("frameTooLarge");
        return bytes;
    }

    internal static int Record(AdapterConfiguration validatedConfig, int intendedExitCode) =>
        WriteBeforeExit(validatedConfig, intendedExitCode, cwd => AdapterConfiguration.RequirePath(cwd, true),
            (path, bytes) =>
            {
                var pending = path + ".pending";
                using (var file = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    file.Write(bytes.Span);
                    file.Flush(true);
                }
                File.Move(pending, path, false);
            });

    // Only used after relay settlement and disposal. Failures propagate to BridgeFailureEvidence.
    internal static int WriteBeforeExit(AdapterConfiguration validatedConfig, int intendedExitCode,
        Action<string> requireDirectory, Action<string, ReadOnlyMemory<byte>> createNew)
    {
        var bytes = Encode(validatedConfig.Generation, intendedExitCode);
        if (!AdapterConfiguration.SamePath(Path.GetDirectoryName(validatedConfig.Cwd)!, validatedConfig.TempRoot) ||
            !Path.GetFileName(validatedConfig.TempRoot).StartsWith("eky-t3a-", StringComparison.Ordinal))
            throw new AdapterFailure("pathInvalid");
        requireDirectory(validatedConfig.Cwd);
        createNew(Path.Combine(validatedConfig.Cwd, FileName), bytes);
        return intendedExitCode;
    }
}
