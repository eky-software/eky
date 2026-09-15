using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

internal static class ProcessCreationMeasurement
{
    internal static SupervisorOutcome Run(
        SupervisorRequest request, Stopwatch stopwatch, SafeEvidenceWriter evidence)
    {
        var timestamps = new ConcurrentDictionary<string, long>(StringComparer.Ordinal);
        var supervisor = new WindowsJobProcessSupervisor(stopwatch, evidence,
            (input, job, cancellation) => SuspendedWindowsProcess.Start(input, job, cancellation,
                phase => timestamps.TryAdd(phase, stopwatch.ElapsedTicks)));
        var result = supervisor.Run(request);
        long? Read(string phase) => timestamps.TryGetValue(phase, out var ticks) ? ticks : null;
        // Private, closed diagnostic data; no filesystem or console operation inside the native measurement.
        try
        {
            File.WriteAllText(Path.Combine(request.WorkingDirectory, "creation-measurement.json"),
                JsonSerializer.Serialize(new
                {
                    schemaVersion = 1,
                    frequency = Stopwatch.Frequency,
                    preparationStarted = Read("preparationStarted"),
                    nativeCallStarted = Read("nativeCallStarted"),
                    nativeCallReturned = Read("nativeCallReturned"),
                    handlesCaptured = Read("handlesCaptured"),
                    terminal = stopwatch.ElapsedTicks,
                }));
        }
        catch (Exception)
        {
            // Optional diagnostics cannot replace the original process or cleanup result.
        }
        return result;
    }
}
