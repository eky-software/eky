using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

// ConsoleStream treats several broken-pipe statuses as success. This sink must not.
internal sealed class WindowsStandardPipeSink : Stream
{
    private const uint FileTypePipe = 3;
    private const uint DuplicateSameAccess = 2;
    private readonly SafeFileHandle handle;

    internal WindowsStandardPipeSink(bool standardError)
    {
        var original = AdapterNativeMethods.GetStdHandle(standardError ? -12 : -11);
        var process = AdapterNativeMethods.GetCurrentProcess();
        if (original == IntPtr.Zero || original == new IntPtr(-1)) throw new AdapterFailure("stdioHandleMissing");
        if (!AdapterNativeMethods.DuplicateHandle(process, original, process, out var duplicate, 0, false, DuplicateSameAccess))
            throw new AdapterFailure("stdioDuplicateFailed");
        handle = duplicate;
        if (AdapterNativeMethods.GetFileType(handle) != FileTypePipe)
        {
            handle.Dispose();
            throw new AdapterFailure("stdioHandleTypeInvalid");
        }
    }

    internal static void ValidateWrite(bool success, int error, uint written, int requested)
    {
        if (!success) throw new AdapterFailure(error is 109 or 232 or 233 ? "stdioBrokenPipe" : "stdioNativeWriteFailed");
        if (requested <= 0 || requested > AdapterProtocol.RelayChunkBytes || written != (uint)requested)
            throw new AdapterFailure("stdioWriteIncomplete");
    }

    public override ValueTask WriteAsync(ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (bytes.Length is <= 0 or > AdapterProtocol.RelayChunkBytes) throw new AdapterFailure("stdioWriteIncomplete");
        var retained = bytes.ToArray();
        // ByteRelay invokes this on its single write worker, with an independent deadline.
        // P/Invoke retains both the buffer and SafeHandle throughout the synchronous call.
        var success = AdapterNativeMethods.WriteFile(handle, retained, (uint)retained.Length, out var written, IntPtr.Zero);
        var error = success ? 0 : Marshal.GetLastWin32Error();
        ValidateWrite(success, error, written, retained.Length);
        return ValueTask.CompletedTask;
    }

    protected override void Dispose(bool disposing) { if (disposing) handle.Dispose(); base.Dispose(disposing); }
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
