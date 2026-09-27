using System.Diagnostics;

namespace Eky.ProcessOwnershipAdapter;

// The origin is captured before config reading; exports use this same elapsed clock.
internal sealed class ElectronBridgeClock
{
    private readonly long origin;
    private readonly Func<long> timestamp;
    private long previous;
    private bool failed;
    internal long Frequency { get; }

    internal ElectronBridgeClock(long origin, long frequency, Func<long> timestamp)
    {
        if (origin < 0 || frequency <= 0 || timestamp is null) throw new AdapterFailure("ownerFailed");
        this.origin = previous = origin;
        Frequency = frequency;
        this.timestamp = timestamp;
    }

    internal static ElectronBridgeClock StartNew()
    {
        if (!Stopwatch.IsHighResolution) throw new AdapterFailure("ownerFailed");
        return new(Stopwatch.GetTimestamp(), Stopwatch.Frequency, Stopwatch.GetTimestamp);
    }

    internal long ReadElapsedMilliseconds()
    {
        if (failed) throw new AdapterFailure("ownerFailed");
        try
        {
            var current = timestamp();
            if (current < previous) throw new AdapterFailure("ownerFailed");
            previous = current;
            var elapsed = ((Int128)current - origin) * 1000 / Frequency;
            if (elapsed > BackendServiceProtocol.MaximumSequence - BackendServiceProtocol.CleanupMilliseconds)
                throw new AdapterFailure("ownerFailed");
            return (long)elapsed;
        }
        catch { failed = true; throw new AdapterFailure("ownerFailed"); }
    }

    internal long DeadlineTimestamp(long elapsedMilliseconds)
    {
        if (failed) throw new AdapterFailure("ownerFailed");
        try
        {
            if (!BackendServiceProtocol.IsWorkDeadline(elapsedMilliseconds)) throw new AdapterFailure("ownerFailed");
            // First QPC tick at which the same integer elapsed clock reaches the bound.
            var delta = ((Int128)elapsedMilliseconds * Frequency + 999) / 1000;
            var deadline = origin + delta;
            if (deadline <= 0 || deadline > long.MaxValue) throw new AdapterFailure("ownerFailed");
            return (long)deadline;
        }
        catch { failed = true; throw new AdapterFailure("ownerFailed"); }
    }
}
