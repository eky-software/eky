using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

internal static class SupervisorResultWriter
{
    internal static object CreateValue(SupervisorRequest request, SupervisorOutcome outcome,
        long durationMilliseconds) => new
    {
        schemaVersion = 1,
        runNonce = request.RunNonce,
        scenario = request.Scenario,
        artifactDescriptorSha256 = request.ArtifactDescriptorSha256,
        status = outcome.Status,
        processResultCode = outcome.ProcessResultCode,
        workerResultCode = outcome.WorkerResultCode,
        cleanupResultCode = outcome.CleanupResultCode,
        processTreeAbsent = outcome.ProcessTreeAbsent,
        durationMs = Math.Max(0, durationMilliseconds),
        childExitCode = outcome.ChildExitCode,
        processWin32ErrorCode = outcome.ProcessWin32ErrorCode,
        cleanupWin32ErrorCode = outcome.CleanupWin32ErrorCode,
    };

    internal static void Write(
        SupervisorRequest request,
        SupervisorOutcome outcome,
        long durationMilliseconds
    ) => Write(request, outcome, durationMilliseconds, null);

    internal static void Write(
        SupervisorRequest request,
        SupervisorOutcome outcome,
        long durationMilliseconds,
        Action<SupervisorResultWritePhase, bool>? observe
    )
    {
        var phase = SupervisorResultWritePhase.TemporaryCreate;
        var lastCompleted = SupervisorResultWritePhase.NotStarted;
        void Enter(SupervisorResultWritePhase next)
        {
            phase = next;
            try { observe?.Invoke(next, false); } catch { /* Optional observation only. */ }
        }
        void Complete()
        {
            lastCompleted = phase;
            try { observe?.Invoke(phase, true); } catch { /* Optional observation only. */ }
        }
        var temporaryPath = Path.Combine(
            Path.GetDirectoryName(request.ResultPath)!,
            $"result-{Guid.NewGuid():N}.tmp"
        );
        try
        {
            Enter(SupervisorResultWritePhase.TemporaryCreate);
            using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                4096,
                FileOptions.WriteThrough
            ))
            {
                Complete();
                Enter(SupervisorResultWritePhase.Serialize);
                JsonSerializer.Serialize(stream, CreateValue(request, outcome, durationMilliseconds));
                Complete();
                Enter(SupervisorResultWritePhase.Flush);
                stream.Flush(true);
                Complete();
                Enter(SupervisorResultWritePhase.Close);
            }
            Complete();
            Enter(SupervisorResultWritePhase.Publish);
            File.Move(temporaryPath, request.ResultPath, false);
            Complete();
        }
        catch
        {
            throw new SupervisorResultWriteFailure(phase, lastCompleted);
        }
        finally
        {
            try
            {
                Enter(SupervisorResultWritePhase.TemporaryCleanup);
                File.Delete(temporaryPath);
                Complete();
            }
            catch
            {
                // A result-write failure remains the terminal supervisor outcome.
            }
        }
        Enter(SupervisorResultWritePhase.Completed);
        Complete();
    }
}

internal enum SupervisorResultWritePhase
{
    NotStarted, WriterStarted, TemporaryCreate, Serialize, Flush, Close, Publish, TemporaryCleanup, Completed,
}

internal sealed class SupervisorResultWriteFailure(SupervisorResultWritePhase? phase = null,
    SupervisorResultWritePhase? lastCompletedPhase = null)
    : Exception("resultWriteFailed")
{
    internal SupervisorResultWritePhase? Phase { get; } = phase;
    internal SupervisorResultWritePhase? LastCompletedPhase { get; } = lastCompletedPhase;
}
