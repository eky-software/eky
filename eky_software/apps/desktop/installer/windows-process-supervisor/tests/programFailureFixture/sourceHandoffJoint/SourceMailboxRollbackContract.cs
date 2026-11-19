using System.ComponentModel;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

namespace Eky.AdmittedSourceTransport;

internal static class SourceMailboxRollbackContract
{
    internal static int Run(string selectedRoot)
    {
        var directory = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(AppContext.BaseDirectory))!;
        var expected = Path.Combine(directory, "rollback-control-fixture");
        if (!string.Equals(Path.GetFullPath(selectedRoot), expected, StringComparison.OrdinalIgnoreCase) ||
            (File.GetAttributes(expected) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory ||
            Directory.EnumerateFileSystemEntries(expected).Any()) return 64;
        var rows = new List<object>();
        var files = new List<FileStream>();
        Exception? first = null;
        var cleanupErrors = new List<Exception>();
        try
        {
            foreach (var kind in new[] { "native", "invalid", "io" })
            foreach (var failClose in new[] { false, true })
            {
                Exception primary = kind switch
                {
                    "native" => new Win32Exception(5),
                    "invalid" => new InvalidDataException("synthetic-original"),
                    _ => new IOException("synthetic-original"),
                };
                var originalHresult = primary.HResult;
                var cleanup = new IOException("synthetic-close");
                var path = Path.Combine(expected, kind + (failClose ? "-close" : "-normal") + ".private");
                var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                files.Add(file);
                var handle = file.SafeFileHandle;
                file.WriteByte(0x5a);
                file.Flush(true);
                var order = new List<string>();
                Exception? observedPrimary = null;
                Exception? observedCleanup = null;
                Exception? returned = null;
                var owned = new ClosingFile(file, () => order.Add("close"), failClose ? cleanup : null);
                try
                {
                    try { throw primary; }
                    catch (Exception error)
                    {
                        SourceHandoffPrototype.CloseFailedMailboxOpen(error, owned,
                            value => { order.Add("primary"); observedPrimary ??= value; },
                            value => { order.Add("cleanup"); observedCleanup ??= value; });
                        throw;
                    }
                }
                catch (Exception error) { returned = error; }
                var expectedOrder = failClose ? new[] { "primary", "close", "cleanup" } : new[] { "primary", "close" };
                var aggregate = returned as AggregateException;
                var originalReturned = failClose ? aggregate?.InnerExceptions.FirstOrDefault() : returned;
                var nativeCodePreserved = primary is not Win32Exception ||
                    observedPrimary is Win32Exception observed && observed.NativeErrorCode == 5;
                var passed = ReferenceEquals(observedPrimary, primary) && ReferenceEquals(originalReturned, primary) &&
                    observedPrimary?.HResult == originalHresult && nativeCodePreserved &&
                    (failClose ? ReferenceEquals(observedCleanup, cleanup) &&
                        aggregate?.InnerExceptions.Count == 2 && ReferenceEquals(aggregate.InnerExceptions[1], cleanup)
                        : observedCleanup is null) &&
                    owned.CloseAttempts == 1 && handle.IsClosed && order.SequenceEqual(expectedOrder) &&
                    File.ReadAllBytes(path).AsSpan().SequenceEqual(new byte[] { 0x5a });
                rows.Add(new { kind, failClose, passed, realHandleClosed = handle.IsClosed,
                    originalObjectPreserved = ReferenceEquals(observedPrimary, primary),
                    originalHresultPreserved = observedPrimary?.HResult == originalHresult,
                    nativeCodePreserved, cleanupCallbackObserved = observedCleanup is not null });
                if (!passed) throw new InvalidDataException("failedOpenRollbackControl");
            }
        }
        catch (Exception error) { first = error; }
        finally
        {
            foreach (var file in files)
                try { file.Dispose(); } catch (Exception error) { cleanupErrors.Add(error); }
        }
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, operation = "failedOpenRollbackHelper",
            status = first is null && cleanupErrors.Count == 0 && rows.Count == 6 ? "completed" : "failed",
            rows, firstFailure = first?.GetType().Name, cleanupFailures = cleanupErrors.Select(error => error.GetType().Name),
            scope = "helperWithRealFilesNotAdmissionOrTransport" }));
        return first is null && cleanupErrors.Count == 0 && rows.Count == 6 ? 0 : 1;
    }

    private sealed class ClosingFile(FileStream file, Action beforeClose, Exception? failure) : IDisposable
    {
        internal int CloseAttempts { get; private set; }
        public void Dispose()
        {
            CloseAttempts++;
            beforeClose();
            file.Dispose();
            if (failure is not null) throw failure;
        }
    }
}
