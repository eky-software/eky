using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.ProcessOwnershipAdapter;

internal enum BridgePhase
{
    Setup, ConnectPipes, ReadEnvironment, ValidateLaunch, OpenStdout, OpenStderr,
    SendLaunch, AwaitStarted, AwaitRootExit, DrainOutput,
}

// Diagnostic evidence only: never readiness, workload success, or a cleanup receipt.
internal static class BridgeFailureEvidence
{
    internal const string FileName = "adapter-bridge-failure.private.json";
    internal const int MaximumBytes = 1024;

    internal static string SafeCode(Exception failure) => failure switch
    {
        AdapterFailure known when known.Code is
            "experimentGuardFailed" or "configurationMissing" or "configurationInvalid" or "pathInvalid" or
            "environmentInvalid" or "frameInvalid" or "frameTooLarge" or "frameTruncated" or "launchInvalid" or
            "controlMissing" or "controlInvalid" or "controlWriteStalled" or "stdioHandleInvalid" or
            "stdioHandleMissing" or "stdioDuplicateFailed" or "stdioHandleTypeInvalid" or
            "stdioBrokenPipe" or "stdioNativeWriteFailed" or "stdioWriteIncomplete" or "stdioWriteStalled" or
            "stdioWriteUnsettled" or "stdioRelayCanceled" or "stdioRelayFailed" or "stdioDrainUnsettled" or
            "deadlineExceeded" => known.Code,
        OperationCanceledException or TimeoutException => "deadlineExceeded",
        IOException => "controlIoFailed",
        UnauthorizedAccessException => "accessDenied",
        JsonException => "frameInvalid",
        System.ComponentModel.Win32Exception => "nativeOperationFailed",
        _ => "adapterInternalFailure",
    };

    internal static byte[] Encode(string generation, BridgePhase phase, Exception failure)
    {
        if (!Regex.IsMatch(generation, "\\A[0-9a-f]{64}\\z", RegexOptions.CultureInvariant))
            throw new AdapterFailure("frameInvalid");
        var safePhase = phase switch
        {
            BridgePhase.Setup => "setup",
            BridgePhase.ConnectPipes => "connectPipes",
            BridgePhase.ReadEnvironment => "readEnvironment",
            BridgePhase.ValidateLaunch => "validateLaunch",
            BridgePhase.OpenStdout => "openStdout",
            BridgePhase.OpenStderr => "openStderr",
            BridgePhase.SendLaunch => "sendLaunch",
            BridgePhase.AwaitStarted => "awaitStarted",
            BridgePhase.AwaitRootExit => "awaitRootExit",
            BridgePhase.DrainOutput => "drainOutput",
            _ => throw new AdapterFailure("frameInvalid"),
        };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new
        { schemaVersion = 1, generation, phase = safePhase, errorCode = SafeCode(failure) });
        if (bytes.Length > MaximumBytes) throw new AdapterFailure("frameTooLarge");
        return bytes;
    }

    internal static int Record(AdapterConfiguration validatedConfig, BridgePhase phase, Exception failure) =>
        ExitWithFailure(validatedConfig.Generation, phase, failure, bytes =>
        {
            AdapterConfiguration.RequirePath(validatedConfig.Cwd, true);
            using var file = new FileStream(Path.Combine(validatedConfig.Cwd, FileName),
                FileMode.CreateNew, FileAccess.Write, FileShare.None);
            file.Write(bytes.Span);
            file.Flush(true);
        });

    // A diagnostic write error must neither replace the first record nor turn failure into success.
    internal static int ExitWithFailure(string generation, BridgePhase phase, Exception failure,
        Action<ReadOnlyMemory<byte>> writeOnce)
    {
        try { writeOnce(Encode(generation, phase, failure)); }
        catch { /* Missing evidence remains missing. There is no console or alternate-path fallback. */ }
        return 1;
    }
}
