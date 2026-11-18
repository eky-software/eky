using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal sealed record MsiResourceProcess(uint ProcessId, uint StartTimeLow, uint StartTimeHigh, string Membership);
internal sealed record MsiResourceSample(string Status, string? SelectionIdentity, int ResourceCount,
    uint? NativeCode, uint? EndSessionCode, IReadOnlyList<MsiResourceProcess> Processes, string Phase = "selection");

// Runs inside the existing optional MSI query; it never changes installation admission.
internal static class MsiResourceObservation
{
    internal static MsiResourceSample Capture(SupervisorRequest request, WindowsJob job, Func<bool> admitted,
        string? fixtureRoot = null, Action? afterQuery = null, Action? beforeQuery = null, SourceRead? sourceRead = null)
    {
        var empty = new MsiResourceSample("unavailable", null, 0, null, null, []);
        if (!admitted()) return empty with { Status = "cancelled" };
        var selection = MsiResourceSelection.Read(request, admitted, fixtureRoot);
        if (selection is null) return empty;
        empty = empty with { SelectionIdentity = selection.Identity, ResourceCount = selection.Files.Length, Phase = "startSession" };
        var code = RmStartSession(out var session, 0, new StringBuilder(33));
        if (code != 0) return empty with { NativeCode = code };
        var sample = empty;
        uint ended;
        try
        {
            if (!admitted()) sample = empty with { Status = "cancelled" };
            else
            {
                empty = empty with { Phase = "registerResources" };
                code = RmRegisterResources(session, (uint)selection.Files.Length, selection.Files, 0, IntPtr.Zero, 0, IntPtr.Zero);
                if (code != 0) sample = empty with { NativeCode = code };
                else if (!admitted()) sample = empty with { Status = "limited", NativeCode = 0 };
                else
                {
                    empty = empty with { Phase = "queryResources" };
                    var capacity = MsiWindowObservation.Contract.MaximumClients;
                    var size = Marshal.SizeOf<ProcessInfo>();
                    var pointer = Marshal.AllocHGlobal(size * capacity);
                    try
                    {
                        var count = (uint)capacity;
                        beforeQuery?.Invoke();
                        code = RmGetList(session, out var needed, ref count, pointer, out _);
                        afterQuery?.Invoke();
                        var status = QueryStatus(code, needed, count, capacity);
                        if (status != "observed") sample = empty with { Status = status, NativeCode = code };
                        else if (!selection.IsCurrent(admitted)) sample = empty with { Status = "limited", NativeCode = 0, Phase = "selection" };
                        else
                        {
                            var processes = new List<MsiResourceProcess>();
                            var identities = new HashSet<(uint, uint, uint)>();
                            var processed = 0;
                            for (var index = 0; index < count; index++)
                            {
                                if (!admitted()) break;
                                var identity = Marshal.PtrToStructure<ProcessInfo>(pointer + index * size).Process;
                                if (identity.Pid == 0 || (identity.Low == 0 && identity.High == 0))
                                { processes.Clear(); status = "unavailable"; break; }
                                if (identities.Add((identity.Pid, identity.Low, identity.High)))
                                    processes.Add(new(identity.Pid, identity.Low, identity.High,
                                        sourceRead is not null && identity.Pid == sourceRead.Birth.Pid
                                            ? sourceRead.MembershipAtSample(job, identity) : Membership(identity, job)));
                                processed++;
                            }
                            sample = empty with { Status = status == "unavailable" ? status :
                                processed == count && admitted() ? "observed" : "limited",
                                NativeCode = 0, Processes = processes,
                                Phase = status != "unavailable" && processed == count && admitted() ? "complete" : "membership" };
                        }
                    }
                    finally { Marshal.FreeHGlobal(pointer); }
                }
            }
        }
        finally { ended = RmEndSession(session); }
        return ended == 0 ? sample with { EndSessionCode = ended } :
            empty with { NativeCode = sample.NativeCode, EndSessionCode = ended, Phase = sample.Phase };
    }

    internal static string QueryStatus(uint code, uint needed, uint count, int capacity) =>
        code == 234 || needed > capacity || count > capacity ? "limited" : code == 0 ? "observed" : "unavailable";

    internal static string ClassifySource(MsiResourceSample? sample, UniqueProcess source, bool sourceLiveAcrossReads)
    {
        if (!sourceLiveAcrossReads || source.Pid == 0 || (source.Low == 0 && source.High == 0) ||
            sample is not { Status: "observed", Phase: "complete",
            NativeCode: 0, EndSessionCode: 0, ResourceCount: > 0, SelectionIdentity: not null }) return "unknown";

        var ownSource = false;
        var other = false;
        foreach (var row in sample.Processes)
        {
            if (row.ProcessId == source.Pid)
            {
                if (row.StartTimeLow != source.Low || row.StartTimeHigh != source.High || row.Membership != "ownedJob")
                    return "unknown";
                ownSource = true;
            }
            else if (row.Membership is "ownedJob" or "outsideJob") other = true;
            else return "unknown";
        }
        return ownSource ? other ? "mixedReported" : "sourceReported" : other ? "otherReported" : "unknown";
    }

    internal static UniqueProcess? ReadCreationIdentity(SafeProcessHandle process)
    {
        var pid = GetProcessId(process);
        return pid != 0 && GetProcessTimes(process, out var birth, out _, out _, out _) && (birth.Low != 0 || birth.High != 0)
            ? new() { Pid = pid, Low = birth.Low, High = birth.High } : null;
    }

    internal sealed class SourceRead : IDisposable
    {
        private readonly object gate = new();
        private readonly SafeProcessHandle view;
        private readonly WindowsJob job;
        private SafeProcessHandle? owner;

        private SourceRead(SafeProcessHandle owner, SafeProcessHandle view, WindowsJob job, UniqueProcess birth)
        {
            this.owner = owner;
            this.view = view;
            this.job = job;
            Birth = birth;
        }

        internal UniqueProcess Birth { get; }

        internal static SourceRead? Retain(SuspendedWindowsProcess source, WindowsJob job, UniqueProcess birth,
            bool sourceJobProvedAtBirth = false)
        {
            if (birth.Pid == 0 || (birth.Low == 0 && birth.High == 0)) return null;
            if (!source.TryRetainSourceObservationHandle()) return null;

            var owner = source.Process;
            var retained = true;
            SafeProcessHandle? view = null;
            try
            {
                if (owner.IsInvalid) return null;
                // A view remains usable after the original owner disposes its reference.
                view = new SafeProcessHandle(owner.DangerousGetHandle(), ownsHandle: false);
                if (ReadCreationIdentity(view) is not { } actual || actual.Pid != birth.Pid ||
                    actual.Low != birth.Low || actual.High != birth.High) return null;
                // The creation handle and initial membership survive as identity
                // evidence even when the original process has already signalled.
                if (!(sourceJobProvedAtBirth && NativeMethods.WaitForSingleObject(view, 0) == NativeMethods.WaitObject0) &&
                    !job.ContainsProcess(view)) return null;

                var read = new SourceRead(owner, view, job, birth);
                retained = false;
                view = null;
                return read;
            }
            catch (Exception error) when (error is ObjectDisposedException or SupervisorFailure) { return null; }
            finally
            {
                try { view?.Dispose(); }
                finally { if (retained) owner.DangerousRelease(); }
            }
        }

        internal string MembershipAtSample(WindowsJob ownerJob, UniqueProcess reported) => ReferenceEquals(ownerJob, job) &&
            reported.Pid == Birth.Pid && reported.Low == Birth.Low && reported.High == Birth.High && IsLive() is true
                ? "ownedJob" : "unknown";

        internal bool IsDirectChild(SafeProcessHandle candidate)
        {
            lock (gate)
            {
                if (owner is null || !job.ContainsProcess(candidate) || ReadCreationIdentity(candidate) is not { } current ||
                    NativeMethods.WaitForSingleObject(candidate, 0) != NativeMethods.WaitTimeout) return false;
                var size = (uint)Marshal.SizeOf<BasicProcessInformation>();
                return NtQueryInformationProcess(candidate, 0, out var information, size, out var length) == 0 &&
                    length == size && IsChildIdentity(Birth, current, information.ProcessId, information.ParentProcessId);
            }
        }

        internal bool? IsLive()
        {
            lock (gate)
            {
                if (owner is null) return null;
                return NativeMethods.WaitForSingleObject(view, 0) switch
                {
                    NativeMethods.WaitTimeout => true,
                    NativeMethods.WaitObject0 => false,
                    _ => null,
                };
            }
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (owner is not { } retained) return;
                owner = null;
                try { view.Dispose(); }
                finally { retained.DangerousRelease(); }
            }
        }
    }

    internal static string Membership(UniqueProcess identity, WindowsJob job, Action? afterMembership = null)
    {
        using var process = OpenProcess(0x1000 | 0x100000, false, identity.Pid);
        if (process.IsInvalid) return "unknown";
        try
        {
            bool Matches() => NativeMethods.WaitForSingleObject(process, 0) == NativeMethods.WaitTimeout &&
                GetProcessId(process) == identity.Pid && GetProcessTimes(process, out var created, out _, out _, out _) &&
                created.Low == identity.Low && created.High == identity.High;
            if (!Matches()) return "unknown";
            var owned = job.ContainsProcess(process);
            afterMembership?.Invoke();
            return Matches() ? owned ? "ownedJob" : "outsideJob" : "unknown";
        }
        catch { return "unknown"; }
    }

    [StructLayout(LayoutKind.Sequential)] internal struct FileTime { internal uint Low; internal uint High; }
    [StructLayout(LayoutKind.Sequential)] internal struct UniqueProcess { internal uint Pid; internal uint Low; internal uint High; }
    internal static bool IsChildIdentity(UniqueProcess source, UniqueProcess child, nuint childId, nuint parentId) =>
        source.Pid != 0 && child.Pid != 0 && child.Pid != source.Pid && childId == child.Pid && parentId == source.Pid &&
        (((ulong)child.High << 32) | child.Low) > (((ulong)source.High << 32) | source.Low);
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicProcessInformation
    {
        internal nint ExitStatus, PebBaseAddress, AffinityMask, BasePriority;
        internal nuint ProcessId, ParentProcessId;
    }
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(SafeProcessHandle process, uint informationClass,
        out BasicProcessInformation information, uint length, out uint returnLength);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessInfo
    {
        internal UniqueProcess Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] internal string AppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] internal string ServiceName;
        internal int ApplicationType;
        internal uint AppStatus;
        internal uint SessionId;
        [MarshalAs(UnmanagedType.Bool)] internal bool Restartable;
    }
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern uint RmStartSession(out uint session, uint flags, StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern uint RmRegisterResources(uint session, uint count,
        [In, MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] files,
        uint applications, IntPtr processes, uint services, IntPtr names);
    [DllImport("rstrtmgr.dll")]
    private static extern uint RmGetList(uint session, out uint needed, ref uint count, IntPtr apps, out uint reboot);
    [DllImport("rstrtmgr.dll")] private static extern uint RmEndSession(uint session);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetProcessTimes(SafeProcessHandle process, out FileTime created,
        out FileTime exited, out FileTime kernel, out FileTime user);
}
