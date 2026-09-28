using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// One consumer owns the control frame order while both byte relays drain.
internal static class ElectronBridgeClientRelay
{
    internal static async Task<int> RunAsync(Stream control, ByteRelay output, ByteRelay error,
        string generation, string nonce, Action requireTime, Action<long> shortenDeadline, CancellationToken work)
    {
        using var observation = CancellationTokenSource.CreateLinkedTokenSource(work);
        var settledOutput = output.SettleAsync(work);
        var settledError = error.SettleAsync(work);
        var state = new ElectronBridgeClientState();
        Task<JsonDocument?>? read = ReadFrame();
        var eof = false;
        try
        {
            while (true)
            {
                requireTime();
                RequireRelaySuccess();
                if (read?.IsCompleted == true)
                {
                    using var frame = await read;
                    read = null;
                    if (frame is null) { state.RequireExpectedEof(); eof = true; }
                    else Accept(frame.RootElement);
                }
                // Read again before declaring success: the frame after rootExit may
                // already contain a duplicate, malformed message or stop deadline.
                if (!eof) read ??= ReadFrame();
                if (read?.IsCompleted == true) continue;
                if (state.RootExited && settledOutput.IsCompleted && settledError.IsCompleted)
                {
                    var outputResult = await settledOutput;
                    var errorResult = await settledError;
                    if (!outputResult.Settled || !errorResult.Settled) throw new AdapterFailure("stdioRelayUnsettled");
                    RequireRelaySuccess();
                    requireTime();
                    break;
                }
                var pending = new List<Task> { output.Failed, error.Failed };
                if (read is not null) pending.Add(read);
                if (!settledOutput.IsCompleted) pending.Add(settledOutput);
                if (!settledError.IsCompleted) pending.Add(settledError);
                await Task.WhenAny(pending).WaitAsync(work);
            }
            observation.Cancel();
            if (read is not null)
            {
                try
                {
                    using var last = await read.WaitAsync(work);
                    if (last is null) state.RequireExpectedEof();
                    else Accept(last.RootElement);
                }
                catch (OperationCanceledException canceled) when (canceled.CancellationToken == observation.Token &&
                    observation.IsCancellationRequested && !work.IsCancellationRequested) { }
                read = null;
            }
            RequireRelaySuccess();
            requireTime();
            return state.ExitCode ?? throw new AdapterFailure("observationLost");
        }
        finally
        {
            observation.Cancel();
            if (read is not null) _ = read.ContinueWith(completed =>
            {
                if (completed.IsCompletedSuccessfully) completed.Result?.Dispose();
                else _ = completed.Exception;
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }

        void Accept(JsonElement frame)
        {
            var message = ElectronBridgeClientProtocol.Parse(frame, generation, nonce);
            state.Accept(message);
            shortenDeadline(message.DeadlineTimestamp);
        }

        Task<JsonDocument?> ReadFrame() => ControlFrame.ReadAsync(control, observation.Token, rejectPartialCancellation: true);

        void RequireRelaySuccess()
        {
            if (output.Failure is { } outputFailure) throw new AdapterFailure(outputFailure);
            if (error.Failure is { } errorFailure) throw new AdapterFailure(errorFailure);
        }
    }
}
