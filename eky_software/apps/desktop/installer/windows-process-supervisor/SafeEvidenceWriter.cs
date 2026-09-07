using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

internal sealed class SafeEvidenceWriter
{
    private const string Operation = "windowsAcceptanceSupervisor";
    private const int MaximumPendingLines = 128;
    private readonly string? scenario;
    private readonly Stopwatch stopwatch;
    private readonly BlockingCollection<string> pendingLines = new(MaximumPendingLines);
    private readonly Thread outputThread;
    private long lastElapsedMilliseconds;
    private readonly Dictionary<string, long> phaseStartedAt = new(StringComparer.Ordinal);

    internal SafeEvidenceWriter(string? scenario, Stopwatch stopwatch)
    {
        this.scenario = scenario;
        this.stopwatch = stopwatch;
        var output = Console.Out;
        outputThread = new Thread(() =>
        {
            foreach (var line in pendingLines.GetConsumingEnumerable())
            {
                try { output.WriteLine(line); }
                catch { /* Diagnostic output cannot change the command outcome. */ }
            }
        }) { IsBackground = true, Name = "supervisor-safe-evidence" };
        outputThread.Start();
    }

    internal void Write(
        string phase,
        string status,
        string? resultCode = null,
        string? errorCode = null,
        int? win32ErrorCode = null
    )
    {
        var elapsedMilliseconds = Math.Max(
            lastElapsedMilliseconds,
            stopwatch.ElapsedMilliseconds
        );
        lastElapsedMilliseconds = elapsedMilliseconds;
        if (string.Equals(status, "started", StringComparison.Ordinal))
        {
            phaseStartedAt[phase] = elapsedMilliseconds;
        }
        var durationMilliseconds = phaseStartedAt.TryGetValue(phase, out var startedAt)
            ? Math.Max(0, elapsedMilliseconds - startedAt)
            : 0;
        TryEnqueue(new
        {
            schemaVersion = 1,
            operation = Operation,
            scenario,
            phase,
            status,
            durationMs = durationMilliseconds,
            elapsedMs = elapsedMilliseconds,
            resultCode,
            errorCode,
            win32ErrorCode,
        });
    }

    internal static void WriteInvalidRequest(
        string errorCode,
        int? win32ErrorCode = null
    )
    {
        try
        {
            var evidence = new SafeEvidenceWriter(null, Stopwatch.StartNew());
            evidence.TryEnqueue(new
            {
                schemaVersion = 1,
                operation = Operation,
                phase = "requestValidated",
                status = "failed",
                durationMs = 0,
                elapsedMs = 0,
                errorCode,
                win32ErrorCode,
            });
            // Invalid input supplies no trusted budget; never wait for its diagnostics.
            evidence.CompleteWithinRequestBudget(0);
        }
        catch { /* Invalid-request rejection does not depend on diagnostic delivery. */ }
    }

    internal void CompleteWithinRequestBudget(long deadlineMilliseconds)
    {
        try
        {
            pendingLines.CompleteAdding();
            var remaining = deadlineMilliseconds - stopwatch.ElapsedMilliseconds;
            // Never extend the existing request deadline to flush best-effort diagnostics.
            if (remaining > 0 && outputThread.Join((int)Math.Min(int.MaxValue, remaining)))
                pendingLines.Dispose();
        }
        catch { /* The strict result was already written independently. */ }
    }

    private void TryEnqueue(object value)
    {
        try { pendingLines.TryAdd(JsonSerializer.Serialize(value, JsonOptions)); }
        catch { /* Full or unavailable output is diagnostic loss, not a process failure. */ }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
}
