using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal enum WorkspaceMsiMembership
{
    None, Owned, Outside, Mixed, Unknown, Limited,
}

// Optional evidence only. The existing MSI count and product checks still decide readiness.
internal sealed class WorkspaceMsiActivityObservation : IDisposable
{
    internal const int MaximumClients = 32;
    internal const int MaximumSamples = 128;
    private const long SampleIntervalMilliseconds = 60_000;
    private readonly WindowsJob job;
    private readonly SafeEvidenceWriter evidence;
    private readonly Func<WindowsJob, WorkspaceMsiMembership> capture;
    private readonly bool enabled;
    private Task<WorkspaceMsiMembership>? pending;
    private long nextSample;
    private int samples;
    private volatile bool stopped;
    internal Task? PendingRead => pending;

    internal WorkspaceMsiActivityObservation(string scenario, WindowsJob job, SafeEvidenceWriter evidence,
        Func<WindowsJob, WorkspaceMsiMembership>? capture = null)
    {
        this.job = job;
        this.evidence = evidence;
        this.capture = capture ?? Capture;
        enabled = scenario is "packagedWorkspaceSuccess" or "packagedWorkspaceFaultRollback";
    }

    internal void Poll(long elapsedMilliseconds)
    {
        if (!enabled || stopped) return;
        if (pending?.IsCompleted == true) PublishCompleted();
        if (pending is not null || samples >= MaximumSamples || elapsedMilliseconds < nextSample) return;
        samples++;
        nextSample = elapsedMilliseconds + SampleIntervalMilliseconds;
        // Never await optional OS enumeration on the terminal/cleanup path. At most one read exists.
        try { pending = Task.Run(() => stopped ? WorkspaceMsiMembership.Unknown : capture(job)); }
        catch { Publish("unavailable", "observationUnknown"); }
    }

    private void PublishCompleted()
    {
        WorkspaceMsiMembership result;
        try { result = pending!.GetAwaiter().GetResult(); }
        catch { result = WorkspaceMsiMembership.Unknown; }
        pending = null;
        var code = result switch
        {
            WorkspaceMsiMembership.None => "noneObserved",
            WorkspaceMsiMembership.Owned => "ownedObserved",
            WorkspaceMsiMembership.Outside => "outsideObserved",
            WorkspaceMsiMembership.Mixed => "mixedObserved",
            WorkspaceMsiMembership.Limited => "observationLimited",
            _ => "observationUnknown",
        };
        Publish("observed", code);
    }

    private void Publish(string status, string code)
    {
        try { evidence.Write("msiClientMembership", status, code); }
        catch { /* Optional observation must not alter the strict result or cleanup. */ }
    }

    public void Dispose()
    {
        if (stopped) return;
        stopped = true;
        if (pending is null) return;
        if (pending.IsCompleted) PublishCompleted();
        else
        {
            Publish("unavailable", "observationPending");
            // Host exit is owned by the existing outer process boundary, not by this diagnostic.
            _ = pending.ContinueWith(completed => { _ = completed.Exception; },
                CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted |
                TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }
    }

    private WorkspaceMsiMembership Capture(WindowsJob owner)
    {
        if (stopped) return WorkspaceMsiMembership.Unknown;
        Process[] clients = [];
        try
        {
            using var current = Process.GetCurrentProcess();
            var session = current.SessionId;
            clients = Process.GetProcessesByName("msiexec");
            if (clients.Length > MaximumClients) return WorkspaceMsiMembership.Limited;
            var owned = false;
            var outside = false;
            var unknown = false;
            foreach (var client in clients)
            {
                if (stopped) return WorkspaceMsiMembership.Unknown;
                // Keep the process object held while checking image, session and live membership.
                using var handle = OpenProcess(QueryLimitedInformation | Synchronize, false, (uint)client.Id);
                if (handle.IsInvalid) { unknown = true; continue; }
                var name = new StringBuilder(32_768);
                var length = (uint)name.Capacity;
                if (!QueryFullProcessImageName(handle, 0, name, ref length) ||
                    !ProcessIdToSessionId((uint)client.Id, out var actualSession))
                { unknown = true; continue; }
                if (!string.Equals(Path.GetFileName(name.ToString()), "msiexec.exe", StringComparison.OrdinalIgnoreCase))
                { unknown = true; continue; }
                if (actualSession != session) continue;
                switch (ObserveHandle(owner, handle))
                {
                    case WorkspaceMsiMembership.Owned: owned = true; break;
                    case WorkspaceMsiMembership.Outside: outside = true; break;
                    default: unknown = true; break;
                }
            }
            return Combine(owned, outside, unknown);
        }
        catch { return WorkspaceMsiMembership.Unknown; }
        finally { foreach (var client in clients) client.Dispose(); }
    }

    internal static WorkspaceMsiMembership Combine(bool owned, bool outside, bool unknown) =>
        unknown ? WorkspaceMsiMembership.Unknown : (owned, outside) switch
        {
            (true, true) => WorkspaceMsiMembership.Mixed,
            (true, false) => WorkspaceMsiMembership.Owned,
            (false, true) => WorkspaceMsiMembership.Outside,
            _ => WorkspaceMsiMembership.None,
        };

    internal static WorkspaceMsiMembership ObserveHandle(WindowsJob owner, SafeProcessHandle process,
        Action? afterMembership = null)
    {
        try
        {
            if (process.IsClosed || process.IsInvalid ||
                NativeMethods.WaitForSingleObject(process, 0) != NativeMethods.WaitTimeout)
                return WorkspaceMsiMembership.Unknown;
            var owned = owner.ContainsProcess(process);
            afterMembership?.Invoke();
            if (NativeMethods.WaitForSingleObject(process, 0) != NativeMethods.WaitTimeout)
                return WorkspaceMsiMembership.Unknown;
            return owned ? WorkspaceMsiMembership.Owned : WorkspaceMsiMembership.Outside;
        }
        catch { return WorkspaceMsiMembership.Unknown; }
    }

    private const uint QueryLimitedInformation = 0x1000;
    private const uint Synchronize = 0x100000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(SafeProcessHandle process, uint flags, StringBuilder name, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);
}
