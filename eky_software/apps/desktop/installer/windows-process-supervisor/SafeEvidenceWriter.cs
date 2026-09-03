using System.Diagnostics;
using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

internal sealed class SafeEvidenceWriter(string scenario, Stopwatch stopwatch)
{
    private const string Operation = "windowsAcceptanceSupervisor";
    private long lastElapsedMilliseconds;
    private readonly Dictionary<string, long> phaseStartedAt = new(StringComparer.Ordinal);

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
        TryWrite(new
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
        TryWrite(new
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
    }

    private static void TryWrite(object value)
    {
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
        }
        catch
        {
            // Observability is best effort and never changes the terminal result.
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
}
