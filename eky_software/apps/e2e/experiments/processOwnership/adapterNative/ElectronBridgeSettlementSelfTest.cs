using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static class ElectronBridgeSettlementSelfTest
{
    internal static async Task<int> RunChecksAsync()
    {
        var checks = 0;
        void Check(bool condition) { checks++; if (!condition) throw new AdapterFailure("electronSelfTestFailed"); }
        void RejectFrame(Task<JsonDocument?> frame, bool exited, string code)
        {
            try { ElectronBridgeChannel.RequireNoUnexpectedFrame(frame, exited); }
            catch (AdapterFailure failure) { Check(failure.Code == code); return; }
            throw new AdapterFailure("electronSelfTestFailed");
        }

        var pending = new TaskCompletionSource<JsonDocument?>();
        foreach (var exited in new[] { false, true })
        {
            ElectronBridgeChannel.RequireNoUnexpectedFrame(null, exited); checks++;
            ElectronBridgeChannel.RequireNoUnexpectedFrame(pending.Task, exited); checks++;
            using var unexpected = JsonDocument.Parse("{}");
            RejectFrame(Task.FromResult<JsonDocument?>(unexpected), exited, "protocolInvalid");
            RejectFrame(Task.FromException<JsonDocument?>(new IOException("synthetic")), exited, "protocolInvalid");
            RejectFrame(Task.FromCanceled<JsonDocument?>(new CancellationToken(true)), exited, "protocolInvalid");
        }
        var eof = Task.FromResult<JsonDocument?>(null);
        RejectFrame(eof, false, "bridgePeerObservationFailed");
        ElectronBridgeChannel.RequireNoUnexpectedFrame(eof, true); checks++;
        pending.SetResult(null);
        RejectFrame(pending.Task, false, "bridgePeerObservationFailed");
        ElectronBridgeChannel.RequireNoUnexpectedFrame(pending.Task, true); checks++;

        using var ownerStop = new CancellationTokenSource();
        var canceledRead = new TaskCompletionSource<JsonDocument?>();
        Check(ElectronBridgeChannel.ObservationFailure(canceledRead.Task, false) is null);
        ownerStop.Cancel(); canceledRead.SetCanceled(ownerStop.Token);
        Check(ElectronBridgeChannel.ObservationFailure(canceledRead.Task, false, ownerStop.Token) is null);
        Check(ElectronBridgeChannel.ObservationFailure(canceledRead.Task, false) == "protocolInvalid");
        foreach (var exited in new[] { false, true })
        {
            using var unexpected = JsonDocument.Parse("{}");
            Check(ElectronBridgeChannel.ObservationFailure(Task.FromResult<JsonDocument?>(unexpected), exited, ownerStop.Token) == "protocolInvalid");
            Check(ElectronBridgeChannel.ObservationFailure(Task.FromException<JsonDocument?>(new IOException("synthetic")), exited, ownerStop.Token) == "protocolInvalid");
            Check(ElectronBridgeChannel.ObservationFailure(Task.FromCanceled<JsonDocument?>(new CancellationToken(true)), exited, ownerStop.Token) == "protocolInvalid");
        }
        Check(ElectronBridgeChannel.ObservationFailure(eof, false, ownerStop.Token) == "bridgePeerObservationFailed");
        Check(ElectronBridgeChannel.ObservationFailure(eof, true, ownerStop.Token) is null);

        // Stop captures an already completed observation before any cleanup write can fail.
        using (var unexpected = JsonDocument.Parse("{}"))
        {
            var state = new BackendServiceState();
            state.BeginStop();
            var failure = ElectronBridgeChannel.ObservationFailure(Task.FromResult<JsonDocument?>(unexpected), false);
            Check(failure == "protocolInvalid");
            state.Fail(ElectronBridgeServiceProtocol.OperationalFailure(new AdapterFailure(failure!)));
            state.Fail("stdioFailed");
            Check(state.FirstFailure == "protocolInvalid");
        }

        foreach (var kind in new[] { "successThenCallerFailure", "synchronousThrow", "partialFailure", "canceled", "lateCompletion" })
        {
            var notification = new ElectronBridgeExitNotification();
            var calls = 0;
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            Task Send()
            {
                calls++;
                if (kind == "synchronousThrow") throw new IOException("synthetic");
                return release.Task;
            }
            var first = notification.SendOnceAsync(Send);
            Check(calls == 1);
            // Re-entering cleanup while the first write is still pending cannot issue another frame.
            await notification.SendOnceAsync(Send);
            Check(calls == 1);
            switch (kind)
            {
                case "partialFailure": release.SetException(new IOException("synthetic")); break;
                case "canceled": release.SetCanceled(); break;
                default: release.SetResult(); break;
            }
            var failed = false;
            try { await first; }
            catch (Exception failure) when (failure is IOException or OperationCanceledException) { failed = true; }
            Check(failed == (kind is "synchronousThrow" or "partialFailure" or "canceled"));
            if (kind == "successThenCallerFailure")
            {
                try { throw new IOException("caller reply failed after bridge write"); }
                catch (IOException) { await notification.SendOnceAsync(Send); }
            }
            await notification.SendOnceAsync(Send);
            await notification.SendOnceAsync(Send);
            Check(calls == 1);
        }
        return checks;
    }
}
