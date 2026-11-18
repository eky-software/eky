using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

// Private source-admission primitive only, not execution or deletion authority.
// The metadata reader owns each scope, serializes its calls/disposal and retains
// it through its operation.
// Directory write-sharing permits child publication but does not exclude arbitrary
// reparse races. These held/current checks are observations, not that guarantee.
internal sealed class SourceAdmissionFiles : IDisposable
{
    private const uint GenericRead = 0x80000000;
    private const uint DirectoryRead = 0x81;
    private const uint OpenExisting = 3;
    private const uint OpenReparsePoint = 0x00200000;
    private const uint BackupSemantics = 0x02000000;
    private const uint DirectorySharing = (uint)(FileShare.Read | FileShare.Write);
    private const uint FileSharing = (uint)FileShare.Read;
    private const uint Synchronize = 0x00100000;
    private const uint CreateNew = 2;
    private const ulong Created = 2;
    private const uint DirectoryFile = 0x00000001;
    private const uint SynchronousIoNonAlert = 0x00000020;
    private const uint CaseInsensitive = 0x00000040;
    private const uint DontReparse = 0x00001000;
    private const int MinimumJsonBytes = 2;
    private const int FinalPathCapacity = 32_768;

    private readonly List<Pin> pins = new();
    private bool disposed;
    private ExceptionDispatchInfo? firstCloseFailure;

    private SourceAdmissionFiles() { }

    internal int PinCount => pins.Count;
    internal bool AllHandlesClosed
    {
        get
        {
            if (firstCloseFailure is not null) return false;
            foreach (var pin in pins)
                if (!pin.Handle.IsClosed) return false;
            return true;
        }
    }

    internal static SourceAdmissionFiles OpenRoot(string canonicalPath)
    {
        var path = CanonicalPath(canonicalPath);
        var result = new SourceAdmissionFiles();
        result.Admit(Pin.OpenDirectory(path));
        return result;
    }

    internal void PinChildDirectory(string canonicalPath)
    {
        ThrowIfDisposed();
        var path = CanonicalPath(canonicalPath);
        RequirePinnedParent(path);
        VerifyAll();
        var existing = FindPin(path);
        if (existing is not null)
        {
            if (!existing.IsDirectory) throw new InvalidDataException();
            return;
        }
        Admit(Pin.OpenDirectory(path));
    }

    internal void CreateReservedChildDirectory(string canonicalPath)
    {
        ThrowIfDisposed();
        var path = CanonicalPath(canonicalPath);
        _ = NativePath(path);
        var parent = FindPin(System.IO.Path.GetDirectoryName(path) ?? "");
        if (parent is not { IsDirectory: true } || FindPin(path) is not null)
            throw new InvalidDataException();
        VerifyAll();
        Admit(Pin.CreateReservedDirectory(path, parent.Handle));
    }

    internal void VerifyCreatedPreparation(string temporaryParent, string runRoot)
    {
        ThrowIfDisposed();
        var scenario = System.IO.Path.Combine(runRoot, "scenario");
        if (pins.Count != 3 || !string.Equals(pins[0].Path, temporaryParent, StringComparison.Ordinal) || !pins[0].IsDirectory ||
            !string.Equals(pins[1].Path, runRoot, StringComparison.Ordinal) || !pins[1].CreatedDirectory ||
            !string.Equals(pins[2].Path, scenario, StringComparison.Ordinal) || !pins[2].CreatedDirectory)
            throw new InvalidDataException();
        VerifyAll();
    }

    // Returns fresh bytes only; the stored bytes are a private integrity baseline.
    // JSON shape, nonces, history and authority remain the reader's responsibility.
    internal byte[] ReadPinnedJson(string path, int maxBytes)
    {
        ThrowIfDisposed();
        if (maxBytes < MinimumJsonBytes) throw new ArgumentOutOfRangeException(nameof(maxBytes));
        path = CanonicalPath(path);
        RequirePinnedParent(path);
        VerifyAll();
        var pin = FindPin(path);
        if (pin is null)
        {
            pin = Pin.OpenFile(path, maxBytes);
            Admit(pin);
        }
        if (pin.IsDirectory) throw new InvalidDataException();
        var bytes = pin.ReadVerified(maxBytes);
        VerifyAll();
        return bytes;
    }

    internal void VerifyAll()
    {
        ThrowIfDisposed();
        VerifyDirectories();
        foreach (var pin in pins)
            if (!pin.IsDirectory) VerifyPin(pin);
        VerifyDirectories();
    }

    internal FileStream OpenPinnedExecutable(string canonicalPath)
    {
        var path = CanonicalPath(canonicalPath);
        RequirePinnedParent(path);
        VerifyAll();
        var handle = OpenHandle(path, false);
        try
        {
            _ = Information(handle, path, false, "initial");
            VerifyAll();
            return new FileStream(handle, FileAccess.Read, 4096, false);
        }
        catch (Exception failure)
        {
            CloseAfterFailure(null, handle, failure);
            throw;
        }
    }

    private void VerifyDirectories()
    {
        foreach (var pin in pins)
            if (pin.IsDirectory) VerifyPin(pin);
    }

    private Pin? FindPin(string path)
    {
        foreach (var pin in pins)
            if (string.Equals(pin.Path, path, StringComparison.OrdinalIgnoreCase)) return pin;
        return null;
    }

    private void RequirePinnedParent(string path)
    {
        var parent = System.IO.Path.GetDirectoryName(path);
        if (parent is null || FindPin(parent) is not { IsDirectory: true })
            throw new InvalidDataException();
    }

    private void Admit(Pin pin)
    {
        try
        {
            VerifyAll();
            VerifyPin(pin);
            VerifyDirectories();
            pins.Add(pin);
        }
        catch (Exception failure)
        {
            // Only the untransferred pin is owned by this failed admission.
            try { pin.Dispose(); }
            catch (Exception closeFailure) { throw new AggregateException(failure, closeFailure); }
            throw;
        }
    }

    private void VerifyPin(Pin pin)
    {
        try { pin.Verify(); }
        catch (Exception error)
        {
            try
            {
                var index = pins.IndexOf(pin);
                error.Data["sourceAdmissionPinOrdinal"] = index < 0 ? pins.Count : index;
                error.Data["sourceAdmissionPinKind"] = pin.IsDirectory ? "directory" : "file";
            }
            catch { }
            throw;
        }
    }

    private static string CanonicalPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !System.IO.Path.IsPathFullyQualified(path))
            throw new InvalidDataException();
        var full = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(path));
        if (!string.Equals(path, full, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(full, System.IO.Path.GetPathRoot(full), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException();
        // Admit exactly this root/child. Never open its unpinned ancestors.
        return full;
    }

    private void ThrowIfDisposed()
    {
        if (disposed) throw new ObjectDisposedException(nameof(SourceAdmissionFiles));
    }

    public void Dispose()
    {
        disposed = true;
        for (var index = pins.Count - 1; index >= 0; index--)
        {
            try { pins[index].Dispose(); }
            catch (Exception failure) { firstCloseFailure ??= ExceptionDispatchInfo.Capture(failure); }
        }
        firstCloseFailure?.Throw();
    }

    private sealed class Pin : IDisposable
    {
        internal string Path { get; }
        internal SafeFileHandle Handle { get; }
        internal bool IsDirectory => stream is null;
        internal bool CreatedDirectory { get; }
        private readonly FileInformation identity;
        private readonly FileStream? stream;
        private readonly byte[]? originalBytes;
        private readonly byte[]? originalHash;

        private Pin(string path, SafeFileHandle handle, FileInformation identity,
            FileStream? stream = null, byte[]? bytes = null, bool createdDirectory = false)
        {
            Path = path;
            Handle = handle;
            this.identity = identity;
            this.stream = stream;
            CreatedDirectory = createdDirectory;
            originalBytes = bytes;
            originalHash = bytes is null ? null : SHA256.HashData(bytes);
        }

        internal static Pin OpenDirectory(string path)
        {
            var handle = OpenHandle(path, true);
            try { return new Pin(path, handle, Information(handle, path, true, "initial")); }
            catch (Exception failure)
            {
                CloseAfterFailure(null, handle, failure);
                throw;
            }
        }

        internal static Pin CreateReservedDirectory(string path, SafeFileHandle parent)
        {
            var handle = CreateDirectoryHandle(parent, System.IO.Path.GetFileName(path));
            try { return new Pin(path, handle, Information(handle, path, true, "created"), createdDirectory: true); }
            catch (Exception failure)
            {
                CloseAfterFailure(null, handle, failure);
                throw;
            }
        }

        internal static Pin OpenFile(string path, int maximum)
        {
            var handle = OpenHandle(path, false);
            FileStream? stream = null;
            try
            {
                stream = new FileStream(handle, FileAccess.Read, 4096, false);
                var identity = Information(handle, path, false, "initial");
                var bytes = ReadBounded(stream, maximum);
                if (!SameFileIdentity(Information(handle, path, false, "initial"), identity))
                    throw new InvalidDataException();
                return new Pin(path, handle, identity, stream, bytes);
            }
            catch (Exception failure)
            {
                CloseAfterFailure(stream, handle, failure);
                throw;
            }
        }

        internal void Verify()
        {
            if (!IsDirectory)
            {
                _ = ReadVerified(originalBytes!.Length);
                return;
            }
            // A directory's mtime/size change when children are published.
            if (!SameFileId(Information(Handle, Path, true), identity))
                throw new InvalidDataException();
            using var current = OpenHandle(Path, true, "fresh");
            if (!SameFileId(Information(current, Path, true, "fresh"), identity) ||
                !SameFileId(Information(Handle, Path, true), identity))
                throw new InvalidDataException();
        }

        internal byte[] ReadVerified(int maximum)
        {
            if (stream is null || originalBytes is null || originalHash is null)
                throw new InvalidDataException();
            if (!SameFileIdentity(Information(Handle, Path, false), identity))
                throw new InvalidDataException();
            var bytes = ReadBounded(stream, maximum);
            CheckBytes(bytes);
            if (!SameFileIdentity(Information(Handle, Path, false), identity))
                throw new InvalidDataException();

            // Reopen the current name, not a cached path-to-identity decision.
            using var currentHandle = OpenHandle(Path, false, "fresh");
            using var current = new FileStream(currentHandle, FileAccess.Read, 4096, false);
            if (!SameFileIdentity(Information(currentHandle, Path, false, "fresh"), identity))
                throw new InvalidDataException();
            CheckBytes(ReadBounded(current, maximum));
            if (!SameFileIdentity(Information(currentHandle, Path, false, "fresh"), identity) ||
                !SameFileIdentity(Information(Handle, Path, false), identity))
                throw new InvalidDataException();
            return bytes;
        }

        private void CheckBytes(byte[] bytes)
        {
            if (!bytes.AsSpan().SequenceEqual(originalBytes) ||
                !CryptographicOperations.FixedTimeEquals(SHA256.HashData(bytes), originalHash))
                throw new InvalidDataException();
        }

        public void Dispose() => CloseOwned(stream, Handle);
    }

    private static byte[] ReadBounded(FileStream stream, int maximum)
    {
        var length = stream.Length;
        if (length < MinimumJsonBytes || length > maximum) throw new InvalidDataException();
        var bytes = new byte[(int)length];
        stream.Position = 0;
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1 || stream.Length != length) throw new InvalidDataException();
        return bytes;
    }

    // Only this fixture's already canonical local-drive paths enter native calls.
    internal static string NativePath(string path)
    {
        var canonical = CanonicalPath(path);
        if (canonical.Length < 3 || canonical[1] != ':' || canonical[2] != '\\')
            throw new InvalidDataException();
        return "\\\\?\\" + canonical;
    }

    private static SafeFileHandle OpenHandle(string path, bool directory, string handleKind = "initial")
    {
        var handle = CreateFile(NativePath(path), directory ? DirectoryRead : GenericRead,
            directory ? DirectorySharing : FileSharing, IntPtr.Zero, OpenExisting,
            OpenReparsePoint | (directory ? BackupSemantics : 0), IntPtr.Zero);
        if (!handle.IsInvalid) return handle;
        var error = Marshal.GetLastWin32Error();
        handle.Dispose();
        if (error == 2) throw NativeObservation(new FileNotFoundException(), error, "CreateFileW", directory, handleKind);
        throw NativeObservation(new Win32Exception(error), error, "CreateFileW", directory, handleKind);
    }

    // Only create a single name relative to the already pinned parent. The creation
    // handle supplies the identity; a path reopen is only a subsequent comparison.
    private static SafeFileHandle CreateDirectoryHandle(SafeFileHandle parent, string name)
    {
        if (name.Length is < 1 or > 255) throw new InvalidDataException();
        foreach (var character in name)
            if (!char.IsAsciiLetterOrDigit(character) && character != '-') throw new InvalidDataException();

        var buffer = IntPtr.Zero;
        var descriptor = IntPtr.Zero;
        var parentReferenced = false;
        try
        {
            var length = checked((ushort)(name.Length * sizeof(char)));
            buffer = Marshal.StringToHGlobalUni(name);
            descriptor = Marshal.AllocHGlobal(Marshal.SizeOf<UnicodeName>());
            Marshal.StructureToPtr(new UnicodeName(length, (ushort)(length + sizeof(char)), buffer), descriptor, false);
            parent.DangerousAddRef(ref parentReferenced);
            var attributes = new ObjectAttributes(Marshal.SizeOf<ObjectAttributes>(), parent.DangerousGetHandle(),
                descriptor, CaseInsensitive | DontReparse, IntPtr.Zero, IntPtr.Zero);
            var status = NtCreateFile(out var handle, DirectoryRead | Synchronize, ref attributes, out var io,
                IntPtr.Zero, 0, FileSharing, CreateNew, DirectoryFile | SynchronousIoNonAlert, IntPtr.Zero, 0);
            if (status == 0 && io.Information.ToUInt64() == Created && !handle.IsInvalid) return handle;

            var failure = NativeObservation(new InvalidDataException(), status, "NtCreateFile", true, "created");
            CloseAfterFailure(null, handle, failure);
            throw failure;
        }
        finally
        {
            if (parentReferenced) parent.DangerousRelease();
            Marshal.FreeHGlobal(descriptor);
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static FileInformation Information(SafeFileHandle handle, string expected, bool directory, string handleKind = "held")
    {
        if (!GetFileInformationByHandle(handle, out var value))
        {
            var error = Marshal.GetLastWin32Error();
            throw NativeObservation(new Win32Exception(error), error, "GetFileInformationByHandle", directory, handleKind);
        }
        if (directory
            ? (value.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device))
                != FileAttributes.Directory
            : value.NumberOfLinks != 1 ||
                (value.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device)) != 0)
            throw new InvalidDataException();
        var buffer = new StringBuilder(FinalPathCapacity);
        var length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0)
        {
            var error = Marshal.GetLastWin32Error();
            throw NativeObservation(new Win32Exception(error), error, "GetFinalPathNameByHandleW", directory, handleKind);
        }
        if (length >= buffer.Capacity ||
            !string.Equals(System.IO.Path.TrimEndingDirectorySeparator(buffer.ToString()),
                "\\\\?\\" + expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException();
        return value;
    }

    private static Exception NativeObservation(Exception failure, int error, string operation, bool directory, string handleKind)
    {
        try
        {
            failure.Data["sourceAdmissionNativeOperation"] = operation;
            failure.Data["sourceAdmissionNativeError"] = error;
            failure.Data["sourceAdmissionNativeDirectory"] = directory;
            failure.Data["sourceAdmissionHandleKind"] = handleKind;
        }
        catch { }
        return failure;
    }

    private static bool SameFileId(FileInformation left, FileInformation right) =>
        left.VolumeSerialNumber == right.VolumeSerialNumber &&
        left.IndexHigh == right.IndexHigh && left.IndexLow == right.IndexLow;

    private static bool SameFileIdentity(FileInformation left, FileInformation right) =>
        SameFileId(left, right) && left.Attributes == right.Attributes &&
        left.SizeHigh == right.SizeHigh && left.SizeLow == right.SizeLow &&
        left.NumberOfLinks == right.NumberOfLinks &&
        left.CreationTime.Equals(right.CreationTime) && left.LastWriteTime.Equals(right.LastWriteTime);

    private static void CloseOwned(FileStream? stream, SafeFileHandle handle)
    {
        ExceptionDispatchInfo? failure = null;
        try { stream?.Dispose(); }
        catch (Exception error) { failure = ExceptionDispatchInfo.Capture(error); }
        try { handle.Dispose(); }
        catch (Exception error) { failure ??= ExceptionDispatchInfo.Capture(error); }
        failure?.Throw();
    }

    private static void CloseAfterFailure(FileStream? stream, SafeFileHandle handle, Exception failure)
    {
        try { CloseOwned(stream, handle); }
        catch (Exception closeFailure) { throw new AggregateException(failure, closeFailure); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        internal FileAttributes Attributes;
        internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        internal System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        internal System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        internal uint VolumeSerialNumber, SizeHigh, SizeLow, NumberOfLinks, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    private readonly record struct UnicodeName(ushort Length, ushort MaximumLength, IntPtr Buffer);
    [StructLayout(LayoutKind.Sequential)]
    private readonly record struct ObjectAttributes(int Length, IntPtr Root, IntPtr Name, uint Attributes,
        IntPtr Security, IntPtr QualityOfService);
    [StructLayout(LayoutKind.Sequential)]
    private readonly record struct IoStatusBlock(IntPtr Status, UIntPtr Information);
    [DllImport("ntdll.dll", ExactSpelling = true)]
    private static extern int NtCreateFile(out SafeFileHandle handle, uint access, ref ObjectAttributes attributes,
        out IoStatusBlock io, IntPtr allocationSize, uint fileAttributes, uint share, uint disposition, uint options,
        IntPtr ea, uint eaLength);
}
