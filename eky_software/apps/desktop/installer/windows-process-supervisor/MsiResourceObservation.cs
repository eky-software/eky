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
        string? fixtureRoot = null)
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
                        code = RmGetList(session, out var needed, ref count, pointer, out _);
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
                                    processes.Add(new(identity.Pid, identity.Low, identity.High, Membership(identity, job)));
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
