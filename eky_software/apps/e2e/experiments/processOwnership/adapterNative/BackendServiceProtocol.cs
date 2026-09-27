using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static class BackendServiceProtocol
{
    internal const string Name = "eky.e2e.backend-service";
    internal const int Version = 1;
    internal const int CleanupMilliseconds = 3000;
    internal const long MaximumSequence = 9007199254740991;
    internal static readonly string[] OperationalFailures = ["launchRejected", "processStartFailed", "processIdentityFailed",
        "jobMembershipFailed", "processResumeFailed", "workDeadlineExceeded", "callerLost", "protocolInvalid",
        "observationLost", "stdioFailed", "ownerFailed"];
    internal static readonly string[] CleanupFailures = ["jobTerminateFailed", "observationLost", "stdioFailed",
        "cleanupDeadlineExceeded", "evidenceWriteFailed", "ownerFailed"];

    internal static void Identity(JsonElement value, string generation, ServiceProfile profile = ServiceProfile.Backend)
    {
        if (AdapterProtocol.Text(value, "protocol", 64) != ServiceConfiguration.Protocol(profile) ||
            !value.GetProperty("schemaVersion").TryGetInt32(out var version) || version != Version ||
            AdapterProtocol.Token(value, "generation") != generation) throw new AdapterFailure("protocolInvalid");
    }

    internal static bool IsWorkDeadline(long value) => value is >= 1 and <= MaximumSequence;

    internal static BackendServiceRequest Request(JsonElement value, string generation, string nonce, long previous,
        ServiceProfile profile = ServiceProfile.Backend)
    {
        try
        {
            var kind = AdapterProtocol.Text(value, "kind", 16);
            long? workDeadline = null;
            if (kind == "launch")
            {
                AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "sequence", "kind", "launchNonce",
                    "workDeadlineElapsedMilliseconds");
                if (AdapterProtocol.Token(value, "launchNonce") != nonce) throw new AdapterFailure("protocolInvalid");
                if (!value.GetProperty("workDeadlineElapsedMilliseconds").TryGetInt64(out var deadline) || !IsWorkDeadline(deadline))
                    throw new AdapterFailure("protocolInvalid");
                workDeadline = deadline;
            }
            else
            {
                AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "sequence", "kind");
                if (kind is not ("status" or "rss" or "stop")) throw new AdapterFailure("protocolInvalid");
            }
            Identity(value, generation, profile);
            if (!value.GetProperty("sequence").TryGetInt64(out var sequence) || previous >= MaximumSequence ||
                sequence != previous + 1) throw new AdapterFailure("protocolInvalid");
            return new(sequence, kind, workDeadline);
        }
        catch (Exception error) when (error is AdapterFailure or InvalidOperationException or KeyNotFoundException)
        { throw new AdapterFailure("protocolInvalid"); }
    }

    internal static string OperationalFailure(Exception error) => error is AdapterFailure known
        ? OperationalFailures.Contains(known.Code, StringComparer.Ordinal) ? known.Code
            : known.Code.StartsWith("stdio", StringComparison.Ordinal) ? "stdioFailed"
            : known.Code.StartsWith("frame", StringComparison.Ordinal) || known.Code == "controlWriteStalled" ? "protocolInvalid"
            : "ownerFailed"
        : error is JsonException ? "protocolInvalid" : "ownerFailed";
}

internal sealed record BackendServiceRequest(long Sequence, string Kind, long? WorkDeadlineElapsedMilliseconds);
internal sealed record BackendServiceIdentity(uint Pid, string CreationTimeFileTimeHex);
internal sealed record BackendServiceSnapshot(bool Created, bool Started, bool CreationCompleted, bool LaunchClosed,
    BackendServiceIdentity? Identity, string Workload, int? ExitCode, bool AssignedBeforeResume, uint? ActiveProcesses,
    bool StdioSettled, string? FirstFailure, string Cleanup, string? CleanupFailure);
internal sealed record BackendServiceReply(string Protocol, int SchemaVersion, string Generation, long Sequence,
    long? ReplyTo, string Kind, BackendServiceSnapshot State, long? RssBytes, long ElapsedMilliseconds,
    long? CleanupStartedElapsedMilliseconds, long? RemainingCleanupMilliseconds);

// All state changes belong to the owner loop, including creation failure and cleanup.
internal sealed class BackendServiceState
{
    private bool creationInProgress;
    private bool frozen;
    private bool rootExited;
    private BackendServiceSnapshot? terminal;
    internal bool Created { get; private set; }
    internal bool Started { get; private set; }
    internal bool CreationCompleted { get; private set; }
    internal bool LaunchClosed { get; private set; }
    internal BackendServiceIdentity? Identity { get; private set; }
    internal string Workload { get; private set; } = "pending";
    internal int? ExitCode { get; private set; }
    internal bool AssignedBeforeResume { get; private set; }
    internal uint? ActiveProcesses { get; private set; }
    internal bool StdioSettled { get; private set; }
    internal string? FirstFailure { get; private set; }
    internal string? CleanupFailure { get; private set; }
    internal bool Stopping { get; private set; }

    private void Mutable() { if (frozen) throw new AdapterFailure("ownerFailed"); }
    internal void AdmitLaunch()
    {
        Mutable();
        if (LaunchClosed || CreationCompleted || Stopping) throw new AdapterFailure("launchRejected");
        LaunchClosed = true;
        creationInProgress = true;
    }
    internal void MarkCreated()
    {
        Mutable();
        if (!creationInProgress || Created) throw new AdapterFailure("ownerFailed");
        Created = true;
    }
    internal void Identify(BackendServiceIdentity identity)
    {
        Mutable();
        if (!Created || identity.Pid == 0 || Identity is not null) throw new AdapterFailure("processIdentityFailed");
        Identity = identity;
    }
    internal void Assigned() { Mutable(); if (!Created || Started) throw new AdapterFailure("ownerFailed"); AssignedBeforeResume = true; }
    internal void MarkStarted()
    {
        Mutable();
        if (!creationInProgress || !Created || !AssignedBeforeResume || Identity is null || Stopping)
            throw new AdapterFailure("ownerFailed");
        Started = true;
        Workload = "running";
    }
    internal void SettleCreation() { Mutable(); creationInProgress = false; CreationCompleted = true; }
    internal void ObserveRoot(bool exited, int? code)
    {
        Mutable();
        if (exited != code.HasValue || (exited && !Created) || (rootExited && (!exited || ExitCode != code)))
            throw new AdapterFailure("observationLost");
        rootExited = exited;
        ExitCode = code;
        Workload = exited ? "exited" : Started ? "running" : "pending";
    }
    internal void ObserveJob(uint active) { Mutable(); ActiveProcesses = active; }
    internal void LoseObservation()
    {
        Mutable();
        ActiveProcesses = null;
        if (!rootExited) Workload = "unavailable";
    }
    internal void Fail(string code)
    {
        Mutable();
        if (!BackendServiceProtocol.OperationalFailures.Contains(code, StringComparer.Ordinal)) throw new AdapterFailure("ownerFailed");
        FirstFailure ??= code;
    }
    internal void FailCleanup(string code)
    {
        Mutable();
        if (!BackendServiceProtocol.CleanupFailures.Contains(code, StringComparer.Ordinal)) throw new AdapterFailure("ownerFailed");
        CleanupFailure ??= code;
    }
    internal void BeginStop()
    {
        Mutable();
        Stopping = true;
        LaunchClosed = true;
        if (!creationInProgress) CreationCompleted = true;
    }
    internal void SetStdioSettled(bool settled) { Mutable(); StdioSettled = settled; }
    internal bool TreeSettled => LaunchClosed && CreationCompleted && (!Created || rootExited) && ActiveProcesses == 0;
    internal bool CanProveAbsent => Stopping && TreeSettled && StdioSettled && CleanupFailure is null;
    internal BackendServiceSnapshot Snapshot(string cleanup = "pending") => terminal ?? new(Created, Started,
        CreationCompleted, LaunchClosed, Identity, Workload, ExitCode, AssignedBeforeResume, ActiveProcesses,
        StdioSettled, FirstFailure, cleanup, CleanupFailure);
    internal BackendServiceSnapshot Freeze(bool withinDeadline)
    {
        if (terminal is not null) return terminal;
        if (!withinDeadline) FailCleanup("cleanupDeadlineExceeded");
        terminal = Snapshot(CanProveAbsent ? "processTreeAbsent" : "cleanupUnverified");
        frozen = true;
        return terminal;
    }
}

internal sealed class BackendServiceClock(long workMilliseconds, Func<long> elapsed)
{
    private long previous;
    private bool failed;
    private long? workDeadline;
    internal long? CleanupStarted { get; private set; }
    private long Now()
    {
        if (failed) throw new AdapterFailure("ownerFailed");
        long current;
        try { current = elapsed(); }
        catch { failed = true; throw new AdapterFailure("ownerFailed"); }
        if (current < previous || current > BackendServiceProtocol.MaximumSequence - BackendServiceProtocol.CleanupMilliseconds)
        { failed = true; throw new AdapterFailure("ownerFailed"); }
        previous = current;
        return current;
    }
    internal long RemainingWork
    {
        get
        {
            if (workMilliseconds is < 1 or > int.MaxValue) throw new AdapterFailure("ownerFailed");
            return Math.Max(0, (workDeadline ?? workMilliseconds) - Now());
        }
    }
    internal void LatchWorkDeadline(long workDeadlineElapsedMilliseconds)
    {
        if (workDeadline is not null || CleanupStarted is not null) throw new AdapterFailure("launchRejected");
        if (!BackendServiceProtocol.IsWorkDeadline(workDeadlineElapsedMilliseconds)) throw new AdapterFailure("protocolInvalid");
        RequireWork();
        // This is an absolute point on the existing elapsed clock, not a new duration.
        workDeadline = Math.Min(workMilliseconds, workDeadlineElapsedMilliseconds);
        RequireWork();
    }
    internal void RequireWork() { if (RemainingWork == 0) throw new AdapterFailure("workDeadlineExceeded"); }
    internal void BeginStop() { if (CleanupStarted is null) CleanupStarted = Now(); }
    internal (long ElapsedMilliseconds, long? CleanupStartedElapsedMilliseconds, long? RemainingCleanupMilliseconds) ReadTiming()
    {
        var now = Now();
        long? remaining = CleanupStarted is { } start
            ? Math.Max(0, start + BackendServiceProtocol.CleanupMilliseconds - now) : null;
        return (now, CleanupStarted, remaining);
    }
    internal long? RemainingCleanup => CleanupStarted is null ? null : ReadTiming().RemainingCleanupMilliseconds;
    internal void RequireCleanup()
    {
        if (RemainingCleanup is not > 0) throw new AdapterFailure("cleanupDeadlineExceeded");
    }
}
