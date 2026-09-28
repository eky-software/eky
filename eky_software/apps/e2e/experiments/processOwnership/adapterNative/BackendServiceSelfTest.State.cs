namespace Eky.ProcessOwnershipAdapter;

internal static partial class BackendServiceSelfTest
{
    private static BackendServiceState Running()
    {
        var state = new BackendServiceState();
        state.AdmitLaunch(); state.MarkCreated(); state.Identify(new(7, "0000000000000001"));
        state.Assigned(); state.MarkStarted(); state.SettleCreation(); state.ObserveJob(1);
        return state;
    }

    private static void TestState()
    {
        var empty = new BackendServiceState();
        Check(!empty.CanProveAbsent);
        empty.BeginStop();
        Check(empty.CreationCompleted && empty.LaunchClosed && !empty.CanProveAbsent);
        empty.ObserveJob(0); empty.SetStdioSettled(true);
        Check(empty.CanProveAbsent && empty.Freeze(true).Cleanup == "processTreeAbsent");
        Reject(empty.AdmitLaunch);

        var failed = new BackendServiceState();
        failed.AdmitLaunch();
        Reject(failed.AdmitLaunch);
        failed.Fail("processStartFailed"); failed.Fail("ownerFailed");
        failed.BeginStop(); failed.ObserveJob(0); failed.SetStdioSettled(true);
        Check(!failed.CanProveAbsent);
        failed.SettleCreation();
        Check(failed.CanProveAbsent && failed.FirstFailure == "processStartFailed");
        var failedTerminal = failed.Freeze(true);
        Check(failedTerminal.Cleanup == "processTreeAbsent" && !failedTerminal.Created && failedTerminal.CreationCompleted);
        Check(ReferenceEquals(failedTerminal, failed.Freeze(false)));

        var handleLost = new BackendServiceState();
        handleLost.AdmitLaunch(); handleLost.MarkCreated(); handleLost.SettleCreation();
        handleLost.Fail("processIdentityFailed"); handleLost.BeginStop(); handleLost.ObserveJob(0); handleLost.SetStdioSettled(true);
        Check(!handleLost.CanProveAbsent);
        handleLost.ObserveRoot(true, 1);
        Check(handleLost.Freeze(true) is { Cleanup: "processTreeAbsent", Created: true, Identity: null, Started: false });

        var state = Running();
        Reject(state.AdmitLaunch);
        state.ObserveRoot(true, 41); state.ObserveJob(2);
        Check(state.Workload == "exited" && !state.CanProveAbsent);
        state.BeginStop(); state.SetStdioSettled(true);
        Check(!state.CanProveAbsent);
        state.ObserveJob(0);
        Check(state.CanProveAbsent);
        var terminal = state.Freeze(true);
        Check(terminal.Identity!.Pid == 7 && terminal.ExitCode == 41 && terminal.Cleanup == "processTreeAbsent");
        Check(ReferenceEquals(terminal, state.Freeze(false)));
        Reject(() => state.ObserveRoot(false, null));
        Reject(() => state.Fail("callerLost"));

        var live = Running(); live.BeginStop(); live.ObserveJob(0); live.SetStdioSettled(true);
        Check(!live.CanProveAbsent);
        live.ObserveRoot(true, 0); live.SetStdioSettled(false);
        Check(!live.CanProveAbsent);
        live.SetStdioSettled(true);
        Check(live.CanProveAbsent);
        var late = live.Freeze(false);
        Check(late.Cleanup == "cleanupUnverified" && late.CleanupFailure == "cleanupDeadlineExceeded");

        var lost = Running(); lost.LoseObservation();
        Check(lost.Workload == "unavailable" && lost.ActiveProcesses is null && lost.ExitCode is null);
        lost.Fail("observationLost"); lost.BeginStop(); lost.ObserveRoot(true, 0); lost.ObserveJob(0); lost.SetStdioSettled(true);
        Check(lost.Freeze(true) is { Cleanup: "processTreeAbsent", FirstFailure: "observationLost" });

        var exited = Running(); exited.ObserveRoot(true, 0); exited.LoseObservation();
        Check(exited.Workload == "exited" && exited.ExitCode == 0 && exited.ActiveProcesses is null);
        Reject(() => exited.ObserveRoot(false, null));
        Reject(() => exited.ObserveRoot(true, 1));

        var cleanupFailure = Running(); cleanupFailure.Fail("workDeadlineExceeded"); cleanupFailure.BeginStop();
        cleanupFailure.ObserveRoot(true, 1); cleanupFailure.ObserveJob(0); cleanupFailure.SetStdioSettled(true);
        cleanupFailure.FailCleanup("observationLost"); cleanupFailure.FailCleanup("stdioFailed");
        Check(cleanupFailure.Freeze(true) is { Cleanup: "cleanupUnverified", FirstFailure: "workDeadlineExceeded", CleanupFailure: "observationLost" });
        var premature = new BackendServiceState();
        Reject(premature.MarkCreated); Reject(premature.MarkStarted);
        Reject(() => premature.ObserveRoot(true, 0));
        Reject(() => premature.Fail("private raw error"));
        Reject(() => premature.FailCleanup("unknown"));
    }

    private static void TestClocks()
    {
        long now = 125;
        var clock = new BackendServiceClock(60000, () => now);
        Check(clock.RemainingWork == 59875 && clock.RemainingCleanup is null);
        clock.BeginStop();
        Check(clock.CleanupStarted == 125 && clock.RemainingCleanup == 3000);
        now = 1125; clock.BeginStop();
        Check(clock.CleanupStarted == 125 && clock.RemainingCleanup == 2000);
        now = 3125;
        Check(clock.RemainingCleanup == 0 && clock.RemainingWork > 0);
        Reject(clock.RequireCleanup);
        clock.BeginStop(); Check(clock.RemainingCleanup == 0);

        now = 60000;
        var expired = new BackendServiceClock(60000, () => now);
        Reject(expired.RequireWork);
        expired.BeginStop();
        Check(expired.RemainingCleanup == 3000);
        now = 62999; expired.RequireCleanup(); Check(expired.RemainingCleanup == 1);
        now = 63000; Reject(expired.RequireCleanup);

        now = 10;
        var backwards = new BackendServiceClock(60000, () => now);
        Check(backwards.RemainingWork == 59990);
        now = 9; Reject(() => _ = backwards.RemainingWork);
        now = 11; Reject(() => _ = backwards.RemainingWork);
        Reject(() => _ = new BackendServiceClock(0, () => 0).RemainingWork);
        Reject(() => _ = new BackendServiceClock((long)int.MaxValue + 1, () => 0).RemainingWork);
        Reject(() => _ = new BackendServiceClock(1, () => -1).RemainingWork);
        Reject(() => _ = new BackendServiceClock(1, () => throw new InvalidOperationException()).RemainingWork);
        Reject(() => _ = new BackendServiceClock(1, () => long.MaxValue).RemainingWork);
        Check(new BackendServiceClock(int.MaxValue, () => 0).RemainingWork == int.MaxValue);
    }

    private static void TestWorkDeadlineLatch()
    {
        // Only the native clock advances after launch; no caller timer or stop rescues this case.
        const long parentDeadline = 60000;
        const long nativeOrigin = 11000;
        const long constructionAt = 11400;
        long now = 250;
        var delayed = new BackendServiceClock(parentDeadline, () => now);
        var sample = delayed.ReadTiming();
        var target = sample.ElapsedMilliseconds + (parentDeadline - constructionAt);
        now = 500;
        delayed.LatchWorkDeadline(target);
        Check(target == 48850 && nativeOrigin + target < parentDeadline);
        Check(delayed.RemainingWork == 48350 && delayed.CleanupStarted is null);
        now = target - 1;
        delayed.RequireWork(); Check(delayed.RemainingWork == 1);
        now = target;
        RejectCode(delayed.RequireWork, "workDeadlineExceeded");
        delayed.BeginStop();
        Check(delayed.CleanupStarted == target && delayed.RemainingCleanup == 3000);
        now += 1000; delayed.BeginStop();
        Check(delayed.CleanupStarted == target && delayed.RemainingCleanup == 2000);
        now += 2000;
        RejectCode(delayed.RequireCleanup, "cleanupDeadlineExceeded");

        now = 125;
        var capped = new BackendServiceClock(60000, () => now);
        capped.LatchWorkDeadline(BackendServiceProtocol.MaximumSequence);
        Check(capped.RemainingWork == 59875);
        RejectCode(() => capped.LatchWorkDeadline(50000), "launchRejected");
        RejectCode(() => capped.LatchWorkDeadline(70000), "launchRejected");
        Check(capped.RemainingWork == 59875);
        now = 60000;
        RejectCode(capped.RequireWork, "workDeadlineExceeded");

        foreach (var targetAt in new[] { 299L, 300 })
        {
            now = 300;
            var stale = new BackendServiceClock(60000, () => now);
            var state = new BackendServiceState();
            state.AdmitLaunch();
            RejectCode(() => stale.LatchWorkDeadline(targetAt), "workDeadlineExceeded");
            Check(stale.RemainingWork == 0 && !state.Created && !state.Started);
            RejectCode(() => stale.LatchWorkDeadline(60000), "launchRejected");
            state.SettleCreation(); state.Fail("workDeadlineExceeded");
            stale.BeginStop(); state.BeginStop(); state.ObserveJob(0); state.SetStdioSettled(true);
            Check(stale.RemainingCleanup == 3000 && state.Freeze(true) is
                { Created: false, Cleanup: "processTreeAbsent", FirstFailure: "workDeadlineExceeded" });
        }

        now = 25;
        var stopping = new BackendServiceClock(60000, () => now);
        stopping.BeginStop();
        now = 30;
        RejectCode(() => stopping.LatchWorkDeadline(50000), "launchRejected");
        Check(stopping.CleanupStarted == 25 && stopping.RemainingCleanup == 2995);
        foreach (var invalid in new[] { 0L, -1, BackendServiceProtocol.MaximumSequence + 1, long.MaxValue })
        {
            var clock = new BackendServiceClock(60000, () => now);
            RejectCode(() => clock.LatchWorkDeadline(invalid), "protocolInvalid");
            Check(clock.RemainingWork == 59970 && clock.CleanupStarted is null);
        }

        now = 60000;
        var expired = new BackendServiceClock(60000, () => now);
        RejectCode(() => expired.LatchWorkDeadline(70000), "workDeadlineExceeded");
        Check(expired.RemainingWork == 0);
    }
}
