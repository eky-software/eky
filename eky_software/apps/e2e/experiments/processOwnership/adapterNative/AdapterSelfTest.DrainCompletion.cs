using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class AdapterSelfTest
{
    private static async Task TestBridgeDrainCompletionAsync()
    {
        var root = @"C:\synthetic\eky-t3a-receipt";
        var config = new AdapterConfiguration(Generation, Nonce, @"C:\synthetic\electron.exe",
            Path.Combine(root, "electronNormal"), root, new Dictionary<string, string>());
        foreach (var code in new[] { 0, 29, AdapterProtocol.BridgeTestExitCode })
        {
            var bytes = BridgeDrainCompletion.Encode(Generation, code);
            Check(bytes.Length <= BridgeDrainCompletion.MaximumBytes);
            using var document = JsonDocument.Parse(bytes);
            var value = document.RootElement;
            AdapterProtocol.ExactKeys(value, "schemaVersion", "generation", "kind", "intendedExitCode");
            AdapterProtocol.Identity(value, Generation);
            Check(value.GetProperty("kind").GetString() == "drainCompleted");
            Check(value.GetProperty("intendedExitCode").GetInt32() == code);
            Reject(() => AdapterProtocol.Identity(value, Nonce));
        }
        foreach (var code in new[] { -1, 1, 28, 30, 40, 42, int.MinValue, int.MaxValue })
            Reject(() => BridgeDrainCompletion.Encode(Generation, code));
        foreach (var generation in new[] { "", Generation[..63], Generation + "a", Generation.ToUpperInvariant(), "private-value" })
            Reject(() => BridgeDrainCompletion.Encode(generation, 0));

        var validated = false;
        byte[]? stored = null;
        void RequireDirectory(string cwd)
        {
            Check(cwd == config.Cwd);
            validated = true;
        }
        void CreateNew(string path, ReadOnlyMemory<byte> bytes)
        {
            Check(validated);
            Check(path == Path.Combine(config.Cwd, BridgeDrainCompletion.FileName));
            if (stored is not null) throw new IOException("already exists");
            stored = bytes.ToArray();
        }
        Check(BridgeDrainCompletion.WriteBeforeExit(config, 29, RequireDirectory, CreateNew) == 29);
        var first = stored;
        var returned = false;
        try { BridgeDrainCompletion.WriteBeforeExit(config, 0, RequireDirectory, CreateNew); returned = true; }
        catch (IOException) { }
        Check(!returned && ReferenceEquals(stored, first));

        foreach (var invalid in new[]
        {
            config with { Cwd = @"C:\synthetic\elsewhere" },
            config with { Cwd = Path.Combine(config.Cwd, "nested") },
            config with { TempRoot = @"C:\synthetic\other-root" },
            config with { Generation = "not-a-generation" },
        })
            Reject(() => BridgeDrainCompletion.WriteBeforeExit(invalid, 0,
                _ => throw new Exception("must not validate"), (_, _) => throw new Exception("must not write")));
        Reject(() => BridgeDrainCompletion.WriteBeforeExit(config, 0,
            _ => throw new AdapterFailure("pathInvalid"), (_, _) => throw new Exception("must not write")));

        foreach (var failure in new Exception[] { new IOException("synthetic write failure"), new UnauthorizedAccessException() })
        {
            var exitCode = 0;
            byte[]? diagnostic = null;
            try
            {
                exitCode = BridgeDrainCompletion.WriteBeforeExit(config, 0, RequireDirectory, (_, _) => throw failure);
            }
            catch (Exception caught)
            {
                Check(ReferenceEquals(caught, failure));
                exitCode = BridgeFailureEvidence.ExitWithFailure(Generation, BridgePhase.DrainOutput, caught,
                    bytes => diagnostic = bytes.ToArray());
            }
            Check(exitCode == 1 && diagnostic is not null);
        }

        var settledAndDisposed = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var receipts = 0;
        var pending = AdapterBridge.CompleteDrainAsync(() => settledAndDisposed.Task, code => { receipts++; return code; });
        Check(!pending.IsCompleted && receipts == 0);
        settledAndDisposed.SetResult(29);
        Check(await pending == 29 && receipts == 1);
        Check(await AdapterBridge.CompleteDrainAsync(() => Task.FromResult(1), _ => throw new Exception("must not write")) == 1);
        await RejectAsync(async () => await AdapterBridge.CompleteDrainAsync(
            () => Task.FromException<int>(new AdapterFailure("stdioRelayFailed")), _ => throw new Exception("must not write")));
        await RejectAsync(async () => await AdapterBridge.CompleteDrainAsync(
            () => Task.FromResult(0), _ => throw new AdapterFailure("pathInvalid")));
    }
}
