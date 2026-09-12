using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.WindowsProcessSupervisor;

// A fixed auxiliary operation uses the same Job owner. Its control channel is not Console.Out.
internal static partial class InstallerProductOperationProgram
{
    private const int MaximumMessageBytes = 128 * 1024;
    private const string Scenario = "installerProductOperation";
    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex NoncePattern();
    [GeneratedRegex("^\\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\\}$", RegexOptions.CultureInvariant)]
    private static partial Regex ProductPattern();

    internal static int Run(string[] arguments, string? contractWorkerPath = null, string? contractStage = null,
        Func<SupervisorRequest, Stopwatch, SafeEvidenceWriter, SupervisorOutcome>? execute = null)
    {
        var clock = Stopwatch.StartNew();
        SafeEvidenceWriter? evidence = null;
        try
        {
            if (!OperatingSystem.IsWindows() || arguments.Length != 2 || arguments[1].Length > 30_000)
                return 1;
            using var document = JsonDocument.Parse(Convert.FromBase64String(arguments[1]));
            var input = document.RootElement;
            if (!ExactKeys(input, ["schemaVersion", "nonce", "operation", "productCode", "scenarioRoot",
                "nodeExecutable", "workerPath", "timeoutMilliseconds", "cleanupReserveMilliseconds", "deliveryReserveMilliseconds"]) ||
                input.GetProperty("schemaVersion").GetInt32() != 1) return 1;
            var nonce = input.GetProperty("nonce").GetString()!;
            var operation = input.GetProperty("operation").GetString()!;
            var productCode = input.GetProperty("productCode").GetString()!;
            var root = input.GetProperty("scenarioRoot").GetString()!;
            var node = input.GetProperty("nodeExecutable").GetString()!;
            var worker = input.GetProperty("workerPath").GetString()!;
            var timeout = input.GetProperty("timeoutMilliseconds").GetInt32();
            var reserve = input.GetProperty("cleanupReserveMilliseconds").GetInt32();
            var deliveryReserve = input.GetProperty("deliveryReserveMilliseconds").GetInt32();
            if (!NoncePattern().IsMatch(nonce) || !ProductPattern().IsMatch(productCode) ||
                operation is not ("inspect" or "uninstall") || !AbsolutePath(root) ||
                !AbsolutePath(node) || !AbsolutePath(worker) ||
                !string.Equals(Path.GetExtension(node), ".exe", StringComparison.OrdinalIgnoreCase) ||
                Path.GetFileName(worker) != "installerProductOperationWorker.mjs" ||
                timeout is < 200 or > 125_000 || reserve is < 50 or > 5_000 || reserve >= timeout ||
                deliveryReserve is < 50 or > 1_000 || deliveryReserve >= reserve)
                return 1;

            // No request/result filesystem work is performed before the owned worker starts.
            var request = new SupervisorRequest("", "", "", nonce, Scenario, nonce, node,
                contractWorkerPath is null ? [worker, arguments[1]] : [contractWorkerPath, arguments[1], contractStage!],
                root, timeout - deliveryReserve, reserve - deliveryReserve);
            using var caller = new NamedPipeClientStream(".", "eky-product-caller-" + nonce,
                PipeDirection.InOut, PipeOptions.Asynchronous);
            using var transportCancellation = new CancellationTokenSource();
            transportCancellation.CancelAfter(Math.Max(1, timeout - (int)clock.ElapsedMilliseconds));
            caller.ConnectAsync(transportCancellation.Token).GetAwaiter().GetResult();
            using var workerPipe = new NamedPipeServerStream("eky-product-worker-" + nonce,
                PipeDirection.In, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            var received = ReadWorkerAsync(workerPipe, transportCancellation.Token);
            evidence = new SafeEvidenceWriter(Scenario, clock);
            SupervisorOutcome outcome;
            try
            {
                outcome = execute is null
                    ? new WindowsJobProcessSupervisor(clock, evidence,
                        validateWorkerResult: _ => ValidateWorker(received, nonce, operation,
                            timeout - reserve, clock)).Run(request)
                    : execute(request, clock, evidence);
            }
            catch (SupervisorFailure error) { outcome = SupervisorOutcome.UnverifiedFailure(error); }
            catch { outcome = SupervisorOutcome.Failed("unexpectedFailure", "cleanupUnverified", false); }

            var payload = received.IsCompletedSuccessfully ? received.Result : null;
            var bytes = JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = 1, nonce, operation,
                supervisor = SupervisorResultWriter.CreateValue(request, outcome, clock.ElapsedMilliseconds),
                worker = payload is null ? null : Convert.ToBase64String(payload),
            });
            // The mandatory response shares the absolute budget; a missing response is not success.
            caller.WriteAsync(bytes, transportCancellation.Token).AsTask().GetAwaiter().GetResult();
            caller.WriteAsync(new byte[] { 10 }, transportCancellation.Token).AsTask().GetAwaiter().GetResult();
            var acknowledgement = new byte[1];
            if (caller.ReadAsync(acknowledgement, transportCancellation.Token).AsTask().GetAwaiter().GetResult() != 1 ||
                acknowledgement[0] != 1) return 1;
            transportCancellation.Cancel();
            workerPipe.Dispose();
            try { received.GetAwaiter().GetResult(); } catch { }
            return outcome.Status == "completed" ? 0 : 1;
        }
        catch { return 1; }
        finally { evidence?.CompleteWithinRequestBudget(0); }
    }

    private static bool AbsolutePath(string value) =>
        !string.IsNullOrEmpty(value) && !value.Contains('\0') && Path.IsPathFullyQualified(value);

    private static async Task<byte[]> ReadWorkerAsync(NamedPipeServerStream pipe, CancellationToken token)
    {
        try
        {
            await pipe.WaitForConnectionAsync(token);
            using var bytes = new MemoryStream();
            var buffer = new byte[4096];
            while (true)
            {
                var count = await pipe.ReadAsync(buffer, token);
                if (count == 0) return bytes.ToArray();
                if (bytes.Length + count > MaximumMessageBytes) throw new InvalidDataException();
                bytes.Write(buffer, 0, count);
            }
        }
        finally { pipe.Dispose(); }
    }

    private static WorkerTerminalResultValidation ValidateWorker(Task<byte[]> received,
        string nonce, string operation, int deadline, Stopwatch clock)
    {
        try
        {
            var remaining = deadline - clock.ElapsedMilliseconds;
            if (!received.IsCompleted && remaining > 0)
                Task.WaitAny([received], (int)remaining);
            if (!received.IsCompletedSuccessfully) return new(false, "workerResultMissing");
            using var document = JsonDocument.Parse(received.Result);
            var value = document.RootElement;
            if (!ExactKeys(value, ["schemaVersion", "nonce", "operation", "status", "state", "errorCode", "resultCleanup"]) ||
                value.GetProperty("schemaVersion").GetInt32() != 1) return new(false, "workerResultInvalid");
            if (value.GetProperty("nonce").GetString() != nonce || value.GetProperty("operation").GetString() != operation)
                return new(false, "workerResultBindingInvalid");
            return value.GetProperty("status").GetString() == "completed" &&
                value.GetProperty("errorCode").ValueKind == JsonValueKind.Null &&
                value.GetProperty("resultCleanup").GetString() == "completed"
                ? new(true, "workerResultValidated") : new(false, "workerReportedFailure");
        }
        catch { return new(false, "workerResultInvalid"); }
    }

    private static bool ExactKeys(JsonElement value, string[] expected)
    {
        if (value.ValueKind != JsonValueKind.Object) return false;
        var keys = value.EnumerateObject().Select(property => property.Name).ToArray();
        return keys.Length == expected.Length && keys.Distinct(StringComparer.Ordinal).Count() == keys.Length &&
            expected.All(key => keys.Contains(key, StringComparer.Ordinal));
    }
}
