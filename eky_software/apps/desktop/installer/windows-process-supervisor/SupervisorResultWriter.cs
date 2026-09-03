using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

internal static class SupervisorResultWriter
{
    internal static void Write(
        SupervisorRequest request,
        SupervisorOutcome outcome,
        long durationMilliseconds
    )
    {
        var temporaryPath = Path.Combine(
            Path.GetDirectoryName(request.ResultPath)!,
            $"result-{Guid.NewGuid():N}.tmp"
        );
        try
        {
            using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                4096,
                FileOptions.WriteThrough
            ))
            {
                JsonSerializer.Serialize(stream, new
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
                });
                stream.Flush(true);
            }
            File.Move(temporaryPath, request.ResultPath, false);
        }
        finally
        {
            try
            {
                File.Delete(temporaryPath);
            }
            catch
            {
                // A result-write failure remains the terminal supervisor outcome.
            }
        }
    }
}
