using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

internal static class MsiMailboxCoexistenceContract
{
    internal static int Run(string requestPath)
    {
        var request = SupervisorRequestReader.Read(["--request", requestPath]);
        var clock = Stopwatch.StartNew();
        var controls = Path.Combine(request.WorkingDirectory, request.RunNonce);
        var input = Path.Combine(request.WorkingDirectory, "mailbox-request.private.json");
        var output = Path.Combine(request.WorkingDirectory, "mailbox-result.private.json");
        var expected = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            schemaVersion = 1, request.RunNonce, request.Scenario, request.ArtifactDescriptorSha256,
        }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }) + "\n");
        var checks = new Dictionary<string, bool>();
        Exception? firstFailure = null;
        var cleanupFailures = new List<Exception>();
        var streams = new List<FileStream>();
        var handles = new List<SafeFileHandle>();
        FileStream? reader = null;
        FileStream? writer = null;
        var entered = false;
        var exchangeCompleted = false;
        var publication = "notStarted";

        FileStream Own(FileStream file)
        {
            streams.Add(file);
            if (!handles.Contains(file.SafeFileHandle)) handles.Add(file.SafeFileHandle);
            return file;
        }
        SafeFileHandle OpenExisting(string path, bool directory = false)
        {
            var handle = CreateFile(path, directory ? 0x81u : 0x80000000u, 1, IntPtr.Zero, 3,
                directory ? 0x02200000u : 0x00200000u, IntPtr.Zero);
            var error = handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
            handles.Add(handle);
            if (error != 0) throw new Win32Exception(error);
            Validate(handle, path, directory);
            return handle;
        }
        void Use(FileStream file, Action<FileStream> action)
        {
            Exception? primary = null;
            try { action(file); }
            catch (Exception error) { primary = error; throw; }
            finally
            {
                try { file.Dispose(); }
                catch (Exception error)
                {
                    cleanupFailures.Add(error);
                    if (primary is null) throw;
                }
            }
        }

        void Check(string name, bool passed)
        {
            checks.Add(name, passed);
            if (!passed) throw new InvalidDataException("mailboxCoexistence:" + name);
        }
        void Active()
        {
            if (File.Exists(Path.Combine(controls, "abort.release")))
                throw new OperationCanceledException("mailboxCoexistenceAborted");
            if (clock.ElapsedMilliseconds >= request.TimeoutMilliseconds - request.CleanupReserveMilliseconds)
                throw new TimeoutException("mailboxCoexistenceDeadline");
        }
        void Marker(string name)
        {
            Active();
            var path = Path.Combine(controls, name);
            Use(Own(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)),
                file => Validate(file.SafeFileHandle, path));
            Active();
        }
        void Wait(string name)
        {
            var path = Path.Combine(controls, name);
            for (;;)
            {
                Active();
                SafeFileHandle? handle = null;
                try
                {
                    handle = OpenExisting(path);
                }
                catch (Win32Exception error) when (error.NativeErrorCode is 2 or 32) { }
                if (handle is not null)
                {
                    Use(Own(new FileStream(handle, FileAccess.Read)), file =>
                    {
                        if (file.Length != 0) throw new InvalidDataException("mailboxControlNotEmpty");
                    });
                    Active();
                    return;
                }
                Thread.Sleep(20);
            }
        }
        void WriterExcluded(string name)
        {
            try { OpenExisting(input); }
            catch (Win32Exception error) when (error.NativeErrorCode == 32) { Check(name, true); return; }
            throw new InvalidDataException("mailboxWriterWasNotExcluded");
        }

        try
        {
            // This callback runs only after the real owner's full ancestor reservation.
            var evidence = new MsiWindowEvidence(request, () =>
            {
                try
                {
                    entered = true;
                    OpenExisting(controls, directory: true);
                    Marker("reservation.ready");
                    Wait("request-partial.release");
                    WriterExcluded("partialRequestExcluded");
                    Marker("request-partial.ready");
                    Wait("request-complete.release");
                    WriterExcluded("completeOpenRequestExcluded");
                    Marker("request-complete.ready");
                    Wait("request-closed.release");
                    reader = Own(new FileStream(OpenExisting(input), FileAccess.Read));
                    Check("requestSizeBounded", reader.Length is >= 2 and <= 16 * 1024);
                    var bytes = new byte[(int)reader.Length];
                    reader.ReadExactly(bytes);
                    Check("requestConsumedExactlyOnce", reader.ReadByte() == -1 && bytes.AsSpan().SequenceEqual(expected));
                    reader.Dispose();
                    reader = null;
                    Active();
                    writer = Own(new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None));
                    Validate(writer.SafeFileHandle, output);
                    writer.Write(expected.AsSpan(0, expected.Length / 2));
                    writer.Flush(true);
                    Marker("result-held.ready");
                    Wait("result-close.release");
                    writer.Write(expected.AsSpan(expected.Length / 2));
                    writer.Flush(true);
                    writer.Dispose();
                    writer = null;
                    Marker("result-closed.ready");
                    Wait("exchange.release");
                    Check("exchangeCompletedInsideReservation", true);
                    exchangeCompleted = true;
                }
                catch (Exception error) { firstFailure ??= error; throw; }
            });
            publication = evidence.Publish([], clock.ElapsedMilliseconds, () =>
            {
                try { Active(); return false; }
                catch (Exception error) { firstFailure ??= error; return true; }
            });
            Active();
            Check("realReservationEntered", entered);
            Check("actualEvidenceRecorded", publication == "recorded" && exchangeCompleted);
            var attachment = Path.Combine(request.WorkingDirectory, "msi-window-001.private.json");
            Use(Own(new FileStream(OpenExisting(attachment), FileAccess.Read)), published =>
            {
                Check("evidenceSizeBounded", published.Length > 0 && published.Length <= MsiWindowObservation.Contract.MaximumBytes);
                using var parsed = JsonDocument.Parse(published);
                var row = parsed.RootElement;
                Check("actualEvidenceBound", row.GetProperty("runNonce").GetString() == request.RunNonce &&
                    row.GetProperty("scenario").GetString() == request.Scenario &&
                    row.GetProperty("artifactDescriptorSha256").GetString() == request.ArtifactDescriptorSha256);
            });
            Active();
        }
        catch (Exception error) { firstFailure ??= error; }
        finally
        {
            foreach (var file in streams)
                try { file.Dispose(); } catch (Exception error) { cleanupFailures.Add(error); }
            foreach (var handle in handles)
                try { handle.Dispose(); } catch (Exception error) { cleanupFailures.Add(error); }
        }

        if (firstFailure is null && cleanupFailures.Count == 0)
        {
            try
            {
                Active();
                if (handles.Any(handle => !handle.IsClosed)) throw new IOException("mailboxHandleCloseUnverified");
                var path = Path.Combine(request.WorkingDirectory, "msi-mailbox-coexistence.json");
                Use(Own(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)), proof =>
                {
                    JsonSerializer.Serialize(proof, new { checks, publication, exchangeCompleted, ownedStreamsClosed = true });
                    proof.Flush(true);
                });
                Active();
            }
            catch (Exception error) { firstFailure ??= error; }
        }
        if (firstFailure is not null || cleanupFailures.Count != 0)
            throw new AggregateException("mailboxCoexistenceFailed",
                (firstFailure is null ? Enumerable.Empty<Exception>() : new[] { firstFailure }).Concat(cleanupFailures).Distinct());
        return 0;
    }

    private static void Validate(SafeFileHandle file, string path, bool directory = false)
    {
        if (!GetFileInformationByHandle(file, out var information))
            throw new IOException("mailboxFileInformationFailed", new Win32Exception(Marshal.GetLastWin32Error()));
        var kind = information.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device);
        if (directory ? kind != FileAttributes.Directory : kind != 0 || information.NumberOfLinks != 1)
            throw new InvalidDataException("mailboxFileIdentityInvalid");
        var final = new StringBuilder(32_768);
        var length = GetFinalPathNameByHandle(file, final, (uint)final.Capacity, 0);
        if (length == 0) throw new IOException("mailboxFinalPathFailed", new Win32Exception(Marshal.GetLastWin32Error()));
        if (length >= final.Capacity || !string.Equals(Path.TrimEndingDirectorySeparator(final.ToString()),
            "\\\\?\\" + Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("mailboxFinalPathInvalid");
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        internal FileAttributes Attributes;
        internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
        internal uint VolumeSerialNumber, SizeHigh, SizeLow, NumberOfLinks, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags);
}
