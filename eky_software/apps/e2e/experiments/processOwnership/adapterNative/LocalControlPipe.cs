using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static class LocalControlPipe
{
    internal static NamedPipeServerStream Create(string name, PipeDirection direction)
    {
        if (direction is not (PipeDirection.InOut or PipeDirection.Out)) AdapterProtocol.Fail("pipePolicyFailed");
        using var identity = WindowsIdentity.GetCurrent();
        var sid = identity.User?.Value ?? throw new AdapterFailure("pipePolicyFailed");
        // Explicit DACL: only the current SID; native mode also rejects remote clients.
        if (!AdapterNativeMethods.ConvertStringSecurityDescriptorToSecurityDescriptorW($"D:P(A;;GA;;;{sid})", 1,
                out var descriptor, out _)) throw new AdapterFailure("pipePolicyFailed");
        try
        {
            var attributes = new AdapterNativeMethods.SecurityAttributes
            {
                Length = Marshal.SizeOf<AdapterNativeMethods.SecurityAttributes>(),
                SecurityDescriptor = descriptor,
                InheritHandle = false,
            };
            var access = direction == PipeDirection.InOut ? 3u : 2u;
            var handle = AdapterNativeMethods.CreateNamedPipeW(@"\\.\pipe\" + name,
                access | AdapterNativeMethods.FileFlagFirstPipeInstance | AdapterNativeMethods.FileFlagOverlapped,
                AdapterNativeMethods.PipeRejectRemoteClients, 1, AdapterProtocol.PipeBufferBytes,
                AdapterProtocol.PipeBufferBytes, 0, ref attributes);
            if (handle.IsInvalid) { handle.Dispose(); throw new AdapterFailure("pipeCreateFailed"); }
            try { return new NamedPipeServerStream(direction, true, false, handle); }
            catch { handle.Dispose(); throw; }
        }
        finally { AdapterNativeMethods.LocalFree(descriptor); }
    }

    internal static NamedPipeClientStream Client(string name, PipeDirection direction) => new(".", name, direction,
        PipeOptions.Asynchronous, TokenImpersonationLevel.Identification, HandleInheritability.None);
}

// A single frame is bounded including its LF. No StreamReader can prefetch unbounded input.
internal static class ControlFrame
{
    internal static async Task<JsonDocument?> ReadAsync(Stream stream, CancellationToken cancellation)
    {
        var bytes = new byte[AdapterProtocol.FrameBytes];
        for (var index = 0; index < bytes.Length; index++)
        {
            var count = await stream.ReadAsync(bytes.AsMemory(index, 1), cancellation);
            if (count == 0)
            {
                if (index == 0) return null;
                throw new AdapterFailure("frameTruncated");
            }
            if (bytes[index] == (byte)'\n') return AdapterProtocol.Parse(bytes.AsMemory(0, index));
        }
        throw new AdapterFailure("frameTooLarge");
    }

    internal static byte[] Encode(object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, AdapterProtocol.Json);
        if (bytes.Length >= AdapterProtocol.FrameBytes) throw new AdapterFailure("frameTooLarge");
        var frame = new byte[bytes.Length + 1];
        bytes.CopyTo(frame, 0);
        frame[^1] = (byte)'\n';
        return frame;
    }

    internal static async Task WriteAsync(Stream stream, object value, CancellationToken cancellation)
    {
        using var bound = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        bound.CancelAfter(AdapterProtocol.WriteMilliseconds);
        try { await stream.WriteAsync(Encode(value), bound.Token); }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested) { throw new AdapterFailure("controlWriteStalled"); }
    }
}
