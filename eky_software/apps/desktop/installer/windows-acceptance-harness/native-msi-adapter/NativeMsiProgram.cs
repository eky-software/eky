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
        using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out, PipeOptions.Asynchronous);
        await pipe.ConnectAsync();
        var notification = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var observer = new NativeMsiActionObserver(NativeMsiSession.ReadAction, () => notification.TrySetResult(true));
        // One notification slot, no queue and no I/O or wait inside the native callback.
        var delivery = DeliverNotification();
        uint msiExitCode = 0;
        Exception? failure = null;
        try { msiExitCode = install(observer); }
        catch (Exception error) { failure = error; }
        finally { notification.TrySetResult(false); }
        await delivery;
        if (failure is not null) throw failure;
        await Send(new { schemaVersion = 1, nonce, phase = "result", msiExitCode,
            validationObserved = observer.Observed, callbackValid = observer.Valid });
        return checked((int)msiExitCode);

        async Task Send(object value)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
            await pipe.WriteAsync(bytes);
            await pipe.WriteAsync(new byte[] { 10 });
        }
        async Task DeliverNotification()
        {
            if (await notification.Task)
                await Send(new { schemaVersion = 1, nonce, phase = "installValidate" });
        }
    }
}
