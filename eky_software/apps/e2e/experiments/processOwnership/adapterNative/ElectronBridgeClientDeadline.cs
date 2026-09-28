using System.Diagnostics;

namespace Eky.ProcessOwnershipAdapter;

// QPC timestamps come from the current native owner's armed generation. They
// are never compared with Node's process-relative performance clock.
internal sealed class ElectronBridgeClientDeadline(long deadlineTimestamp, long frequency, Func<long> now)
{
    private ElectronBridgeBootstrap bound = new(deadlineTimestamp, frequency);
    private long previous;
    private bool failed;

    internal long RemainingMilliseconds
    {
        get
        {
            if (failed || bound.WorkDeadlineTimestamp <= 0 || frequency <= 0) Invalid();
            long current;
            try { current = now(); }
            catch { failed = true; throw new AdapterFailure("ownerFailed"); }
            if (current < previous || current < 0) { failed = true; Invalid(); }
            previous = current;
            return bound.RemainingMilliseconds(current, frequency);
        }
    }

    internal void RequireRemaining()
    {
        if (RemainingMilliseconds == 0) throw new AdapterFailure("workDeadlineExceeded");
    }

    internal void Shorten(long candidate)
    {
        if (candidate <= 0) Invalid();
        bound = bound with { WorkDeadlineTimestamp = Math.Min(bound.WorkDeadlineTimestamp, candidate) };
        RequireRemaining();
    }

    internal static ElectronBridgeClientDeadline FromBootstrap(ElectronBridgeBootstrap bootstrap)
    {
        if (!Stopwatch.IsHighResolution || bootstrap.Frequency != Stopwatch.Frequency) Invalid();
        return new(bootstrap.WorkDeadlineTimestamp, bootstrap.Frequency, Stopwatch.GetTimestamp);
    }

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new AdapterFailure("protocolInvalid");
}
