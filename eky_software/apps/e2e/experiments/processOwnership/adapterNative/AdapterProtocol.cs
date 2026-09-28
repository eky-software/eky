using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.ProcessOwnershipAdapter;

internal sealed class AdapterFailure(string code) : Exception(code)
{
    internal string Code { get; } = code;
}

internal static class AdapterProtocol
{
    internal const int SchemaVersion = 1;
    internal const int FrameBytes = 4096;
    internal const int WorkMilliseconds = 20000;
    internal const int CleanupMilliseconds = 3000;
    internal const int WriteMilliseconds = 1000;
    internal const int PollMilliseconds = 10;
    internal const int RelayChunkBytes = 8192;
    internal const int PipeBufferBytes = 16384;
    internal const int BridgeTestExitCode = 41;
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    internal static string Token(JsonElement value, string key)
    {
        var token = Text(value, key, 64);
        if (!Regex.IsMatch(token, "\\A[0-9a-f]{64}\\z", RegexOptions.CultureInvariant)) Fail("frameInvalid");
        return token;
    }

    internal static void ExactKeys(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) Fail("frameInvalid");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!names.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) Fail("frameInvalid");
        if (seen.Count != names.Length) Fail("frameInvalid");
    }

    internal static string Text(JsonElement value, string key, int maximum)
    {
        if (!value.TryGetProperty(key, out var field) || field.ValueKind != JsonValueKind.String) Fail("frameInvalid");
        var text = field.GetString()!;
        if (text.Length > maximum || text.Contains('\0')) Fail("frameInvalid");
        return text;
    }

    internal static void Identity(JsonElement value, string generation)
    {
        if (!value.TryGetProperty("schemaVersion", out var version) || version.ValueKind != JsonValueKind.Number ||
            !version.TryGetInt32(out var number) || number != SchemaVersion ||
            Token(value, "generation") != generation) Fail("frameInvalid");
    }

    internal static JsonDocument Parse(ReadOnlyMemory<byte> frame)
    {
        if (frame.Length == 0 || frame.Length >= FrameBytes) Fail("frameInvalid");
        try { return JsonDocument.Parse(frame, new JsonDocumentOptions { MaxDepth = 4 }); }
        catch (JsonException) { throw new AdapterFailure("frameInvalid"); }
    }

    internal static CallerRequest Caller(JsonElement value, string generation, long previousSequence)
    {
        ExactKeys(value, "schemaVersion", "generation", "sequence", "kind");
        Identity(value, generation);
        long sequence = 0;
        if (value.GetProperty("sequence").ValueKind != JsonValueKind.Number ||
            !value.GetProperty("sequence").TryGetInt64(out sequence) || sequence <= previousSequence || sequence < 1 ||
            sequence > 9007199254740991L) Fail("sequenceInvalid");
        var kind = Text(value, "kind", 16);
        if (kind is not ("status" or "stop" or "breakBridge")) Fail("frameInvalid");
        return new(sequence, kind);
    }

    internal static string[] Launch(JsonElement value, AdapterConfiguration config)
    {
        ExactKeys(value, "schemaVersion", "generation", "nonce", "kind", "args", "cwd", "environment");
        Identity(value, config.Generation);
        if (Token(value, "nonce") != config.LaunchNonce || Text(value, "kind", 16) != "launch" ||
            !AdapterConfiguration.SamePath(Text(value, "cwd", 1024), config.Cwd)) Fail("launchInvalid");
        var environment = AdapterConfiguration.EnvironmentMap(value.GetProperty("environment"));
        if (environment.Count != config.Environment.Count || environment.Any(entry =>
                !config.Environment.TryGetValue(entry.Key, out var expected) || expected != entry.Value)) Fail("launchInvalid");
        var arguments = value.GetProperty("args");
        if (arguments.ValueKind != JsonValueKind.Array || arguments.GetArrayLength() is < 1 or > 64) Fail("launchInvalid");
        return arguments.EnumerateArray().Select(argument =>
        {
            if (argument.ValueKind != JsonValueKind.String) Fail("launchInvalid");
            var text = argument.GetString()!;
            if (text.Length > 2048 || text.Contains('\0')) Fail("launchInvalid");
            return text;
        }).ToArray();
    }

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    internal static void Fail(string code) => throw new AdapterFailure(code);
}

internal sealed record CallerRequest(long Sequence, string Kind);

internal sealed record AdapterSnapshot(bool Launched, bool CreationCompleted, bool RootExited, int? RootExitCode,
    uint ActiveProcesses, bool AssignedBeforeResume, bool DescendantsAfterRoot, bool BridgeLost, string Cleanup, string? Failure);

// Only the owner event loop mutates this state; asynchronous I/O never owns cleanup.
internal sealed class AdapterState
{
    internal bool Launched { get; private set; }
    internal bool CreationCompleted { get; private set; }
    internal bool AssignedBeforeResume { get; private set; }
    internal bool RootExited { get; private set; }
    internal int? RootExitCode { get; private set; }
    internal uint ActiveProcesses { get; private set; }
    internal bool DescendantsAfterRoot { get; private set; }
    internal bool BridgeLost { get; private set; }
    internal bool StopRequested { get; private set; }
    internal bool BreakRequested { get; private set; }
    internal string Cleanup { get; private set; } = "pending";
    internal string? Failure { get; private set; }

    internal void RequireLaunch()
    {
        if (Launched || CreationCompleted || StopRequested) AdapterProtocol.Fail("launchReplay");
    }
    internal void Created() { RequireLaunch(); Launched = true; }
    internal void Assigned() { if (!Launched || CreationCompleted) AdapterProtocol.Fail("stateInvalid"); AssignedBeforeResume = true; }
    internal void SettleCreation() => CreationCompleted = true;
    internal void Observe(bool rootExited, int? rootExitCode, uint activeProcesses)
    {
        if (RootExited && (!rootExited || rootExitCode != RootExitCode)) AdapterProtocol.Fail("stateInvalid");
        if (rootExited != rootExitCode.HasValue || (rootExited && !Launched)) AdapterProtocol.Fail("stateInvalid");
        RootExited = rootExited;
        RootExitCode = rootExitCode;
        ActiveProcesses = activeProcesses;
        DescendantsAfterRoot |= rootExited && activeProcesses > 0;
    }
    internal void LoseBridge()
    {
        if (!StopRequested && !RootExited)
        {
            BridgeLost = true;
            if (!BreakRequested) Fail("bridgeLost");
        }
    }
    internal void BreakBridge()
    {
        if (!Launched || !CreationCompleted || RootExited || StopRequested || BreakRequested || BridgeLost)
            AdapterProtocol.Fail("breakBridgeInvalid");
        BreakRequested = true;
    }
    internal void BeginStop()
    {
        StopRequested = true;
        SettleCreation();
        if (!Launched) Fail("launchMissing");
    }
    internal bool CanProveAbsent => StopRequested && CreationCompleted && (!Launched || RootExited) && ActiveProcesses == 0;
    internal void CompleteCleanup()
    {
        Cleanup = CanProveAbsent ? "processTreeAbsent" : "cleanupUnverified";
        if (!CanProveAbsent) Fail("cleanupUnverified");
    }
    internal void UnverifiedCleanup() { Cleanup = "cleanupUnverified"; Fail("cleanupUnverified"); }
    internal void Fail(string code) => Failure ??= code;
    internal AdapterSnapshot Snapshot() => new(Launched, CreationCompleted, RootExited, RootExitCode, ActiveProcesses,
        AssignedBeforeResume, DescendantsAfterRoot, BridgeLost, Cleanup, Failure);
}
