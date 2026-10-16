using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

// A bounded immutable attachment, written inside the existing optional query task.
// No separate writer, queue, await on cleanup, public text or fallback destination.
internal sealed class MsiWindowEvidence(SupervisorRequest request, Action? beforeWrite = null)
{
    private int sequence;

    internal string Publish(IReadOnlyList<MsiWindowSample> clients, long elapsedMilliseconds, Func<bool> stopped,
        MsiResourceSample? resources = null)
    {
        if (stopped()) return "cancelled";
        if (sequence >= WorkspaceMsiActivityObservation.MaximumSamples) return "limited";
        try
        {
            var binding = Binding();
            if (binding is null) return "unavailable";
            var number = ++sequence;
            var bytes = JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = MsiWindowObservation.Contract.SchemaVersion,
                operation = MsiWindowObservation.Contract.Operation,
                binding, request.RunNonce, request.Scenario, request.ArtifactDescriptorSha256,
                sequence = number, elapsedMs = Math.Max(0, elapsedMilliseconds), clients, resources,
            }, MsiWindowObservation.JsonOptions);
            if (bytes.Length > MsiWindowObservation.Contract.MaximumBytes) return "limited";
            if (stopped()) return "cancelled";
            var directory = Path.GetDirectoryName(request.ResultPath)!;
            using var reservation = ReserveDirectory(directory);
            beforeWrite?.Invoke();
            if (stopped()) return "cancelled";
            var destination = Path.Combine(directory, $"{MsiWindowObservation.Contract.FilenamePrefix}{number:D3}.private.json");
            var temporary = destination + ".pending";
            // The collector never selects .pending. CreateNew never replaces earlier evidence.
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                file.Write(bytes);
            if (stopped()) return "cancelled";
            // Parent reservations intentionally forbid rename. Exclusive final creation
            // keeps readers out until close; a killed partial JSON fails strict collection.
            using (var file = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                file.Write(bytes);
            return "recorded";
        }
        catch { return "unavailable"; }
    }

    private static object? Binding()
    {
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true") return new { kind = "local" };
        string Value(string key) => Environment.GetEnvironmentVariable(key) ?? "";
        var runId = Value("GITHUB_RUN_ID"); var attempt = Value("GITHUB_RUN_ATTEMPT");
        var job = Value("GITHUB_JOB"); var sourceRevision = Value("GITHUB_SHA");
        if (!Regex.IsMatch(runId, "^[1-9][0-9]{0,19}$") || !Regex.IsMatch(attempt, "^[1-9][0-9]{0,19}$") ||
            !Regex.IsMatch(job, "^[A-Za-z0-9_-]{1,120}$") || !Regex.IsMatch(sourceRevision, "^[a-f0-9]{40}$")) return null;
        return new { kind = "github", runId, attempt, job, sourceRevision };
    }

    private sealed class DirectoryReservation : IDisposable
    {
        internal readonly List<SafeFileHandle> Handles = [];
        public void Dispose()
        {
            for (var index = Handles.Count - 1; index >= 0; index--) Handles[index].Dispose();
        }
    }

    private static DirectoryReservation ReserveDirectory(string directory)
    {
        var ancestors = new Stack<string>();
        for (var current = new DirectoryInfo(directory); current is not null; current = current.Parent)
            ancestors.Push(current.FullName);
        var reservation = new DirectoryReservation();
        try
        {
            foreach (var path in ancestors)
            {
                // Root first; no write/delete sharing prevents replacement or reparse conversion
                // of an already checked ancestor before exclusive file creation and publication.
                var handle = CreateFile(path, 0x81, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                reservation.Handles.Add(handle);
                if (handle.IsInvalid || !GetFileInformationByHandleEx(handle, 9, out var information, 8) ||
                    (information.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory)
                    throw new IOException("msiWindowEvidenceDirectoryInvalid");
            }
            return reservation;
        }
        catch { reservation.Dispose(); throw; }
    }

    [StructLayout(LayoutKind.Sequential)] private struct AttributeTagInformation
    { internal FileAttributes Attributes; internal uint ReparseTag; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int informationClass,
        out AttributeTagInformation information, uint size);
}
