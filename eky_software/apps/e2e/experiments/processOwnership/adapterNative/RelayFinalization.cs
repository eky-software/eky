namespace Eky.ProcessOwnershipAdapter;

internal static class RelayFinalization
{
    internal static void CaptureFailures(AdapterState state, params ByteRelay?[] relays)
    {
        foreach (var relay in relays)
            if (relay?.Failure is { } code) state.Fail(code);
    }

    // The owner's remaining cleanup deadline is shared with tree cleanup, never restarted here.
    internal static async Task<bool> FinishAsync(AdapterState state, CancellationToken cleanup,
        params ByteRelay?[] relays)
    {
        CaptureFailures(state, relays);
        var settled = await Task.WhenAll(relays.Where(relay => relay is not null)
            .Select(relay => relay!.SettleAsync(cleanup)));
        CaptureFailures(state, relays);
        if (cleanup.IsCancellationRequested || settled.Any(result => !result.Settled))
        {
            state.UnverifiedCleanup();
            return false;
        }
        state.CompleteCleanup();
        return state.Cleanup == "processTreeAbsent";
    }

    internal static async Task<T> ControlOrFailureAsync<T>(Task<T> control, ByteRelay stdout, ByteRelay stderr,
        CancellationToken token)
    {
        await Task.WhenAny(control, stdout.Failed, stderr.Failed).WaitAsync(token);
        // Failure has priority even if the control frame completed in the same cycle.
        if (stdout.Failure is { } outputFailure) throw new AdapterFailure(outputFailure);
        if (stderr.Failure is { } errorFailure) throw new AdapterFailure(errorFailure);
        return await control;
    }
}
