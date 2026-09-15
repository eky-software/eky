using System.IO.Pipes;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.NativeMsiTestAdapter;

internal static class NativeMsiProgram
{
    private static bool CanonicalPath(string path, string extension) =>
        Path.IsPathFullyQualified(path) && Path.GetFullPath(path) == path &&
        string.Equals(Path.GetExtension(path), extension, StringComparison.OrdinalIgnoreCase);

    private static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && args[0] == "--inspect-product") return NativeProductInspection.Run(args);
            if (args.Length != 8 || args[0] != "--package" || args[2] != "--log" ||
                args[4] != "--pipe" || args[6] != "--nonce" ||
                !CanonicalPath(args[1], ".msi") || !CanonicalPath(args[3], ".log") ||
                !Regex.IsMatch(args[7], "\\A[0-9a-f]{64}\\z") || args[5] != "eky-running-msi-" + args[7] ||
                !File.Exists(args[1]) || File.Exists(args[3]) ||
                (File.GetAttributes(args[1]) & FileAttributes.ReparsePoint) != 0) return 64;
            return await Run(args[5], args[7], observer => NativeMsiSession.Install(args[1], args[3], observer));
        }
        catch { return 64; }
    }

    internal static async Task<int> Run(string pipeName, string nonce, Func<NativeMsiActionObserver, uint> install)
    {
        using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync();
        var notification = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var applicationExited = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var observer = new NativeMsiActionObserver(NativeMsiSession.ReadAction, () =>
        {
            notification.TrySetResult(true);
            // The enclosing worker Job owns this wait and every failure cleanup.
            if (!applicationExited.Task.GetAwaiter().GetResult()) throw new InvalidOperationException();
        });
        var delivery = DeliverNotification();
        uint msiExitCode = 0;
        Exception? failure = null;
        try { msiExitCode = install(observer); }
        catch (Exception error) { failure = error; }
        finally { notification.TrySetResult(false); }
        await delivery;
        if (failure is not null) throw failure;
        await Send(new { schemaVersion = 1, nonce, phase = "result", msiExitCode,
            validationObserved = observer.Observed, callbackValid = observer.Valid,
            applicationExitAcknowledged = observer.ApplicationExitAcknowledged });
        return checked((int)msiExitCode);

        async Task Send(object value)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
            await pipe.WriteAsync(bytes);
            await pipe.WriteAsync(new byte[] { 10 });
        }
        async Task DeliverNotification()
        {
            if (!await notification.Task) return;
            try
            {
                await Send(new { schemaVersion = 1, nonce, phase = "installValidate" });
                await ReadApplicationExit();
                applicationExited.TrySetResult(true);
            }
            finally { applicationExited.TrySetResult(false); }
        }
        async Task ReadApplicationExit()
        {
            var bytes = new byte[256];
            var count = 0;
            while (count < bytes.Length)
            {
                var read = await pipe.ReadAsync(bytes.AsMemory(count));
                if (read == 0) throw new InvalidOperationException();
                count += read;
                var boundary = Array.IndexOf(bytes, (byte)10, 0, count);
                if (boundary < 0) continue;
                if (boundary != count - 1) throw new InvalidOperationException();
                using var document = JsonDocument.Parse(bytes.AsMemory(0, boundary));
                var value = document.RootElement;
                if (value.ValueKind != JsonValueKind.Object) throw new InvalidOperationException();
                var properties = value.EnumerateObject().Select(property => property.Name).ToArray();
                if (properties.Length != 3 || properties.Distinct(StringComparer.Ordinal).Count() != 3 ||
                    !value.TryGetProperty("schemaVersion", out var schema) || !schema.TryGetInt32(out var version) || version != 1 ||
                    !value.TryGetProperty("nonce", out var identity) || identity.GetString() != nonce ||
                    !value.TryGetProperty("phase", out var phase) || phase.GetString() != "applicationExited")
                    throw new InvalidOperationException();
                return;
            }
            throw new InvalidOperationException();
        }
    }
}
