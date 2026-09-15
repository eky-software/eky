using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal static class NativeMethods
{
    internal const uint CreateSuspended = 0x00000004;
    internal const uint ExtendedStartupInfoPresent = 0x00080000;
    internal const int JobListAttribute = 0x0002000d;
    internal const uint HandleFlagInherit = 0x00000001;
    internal const uint Infinite = 0xffffffff;
    internal const uint JobObjectLimitKillOnJobClose = 0x00002000;
    internal const int JobObjectBasicAccountingInformationClass = 1;
    internal const int JobObjectExtendedLimitInformationClass = 9;
    internal const uint StillActive = 259;
    internal const uint WaitFailed = 0xffffffff;
    internal const uint WaitObject0 = 0x00000000;
    internal const uint WaitTimeout = 0x00000102;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern SafeJobHandle CreateJobObject(
        IntPtr jobAttributes,
        string? name
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetInformationJobObject(
        SafeJobHandle job,
        int informationClass,
        IntPtr information,
        uint informationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetHandleInformation(
        SafeJobHandle handle,
        out uint flags
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool QueryInformationJobObject(
        SafeJobHandle job,
        int informationClass,
        IntPtr information,
        uint informationLength,
        out uint returnLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool TerminateJobObject(
        SafeJobHandle job,
        uint exitCode
    );

    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool InitializeProcThreadAttributeList(
        IntPtr list, int count, uint flags, ref nuint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UpdateProcThreadAttribute(
        IntPtr list, uint flags, nuint attribute, IntPtr value, nuint size,
        IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    internal static extern void DeleteProcThreadAttributeList(IntPtr list);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern uint ResumeThread(SafeWaitHandle thread);

    [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject", SetLastError = true)]
    internal static extern uint WaitForSingleObject(
        SafeProcessHandle process,
        uint milliseconds
    );

    [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject", SetLastError = true)]
    internal static extern uint WaitForSingleObject(
        SafeJobHandle job,
        uint milliseconds
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetExitCodeProcess(
        SafeProcessHandle process,
        out uint exitCode
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct StartupInfo
    {
        internal uint Size;
        internal string? Reserved;
        internal string? Desktop;
        internal string? Title;
        internal uint X;
        internal uint Y;
        internal uint XSize;
        internal uint YSize;
        internal uint XCountChars;
        internal uint YCountChars;
        internal uint FillAttribute;
        internal uint Flags;
        internal ushort ShowWindow;
        internal ushort Reserved2Size;
        internal IntPtr Reserved2;
        internal IntPtr StandardInput;
        internal IntPtr StandardOutput;
        internal IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct ProcessInformation
    {
        internal IntPtr Process;
        internal IntPtr Thread;
        internal uint ProcessId;
        internal uint ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct StartupInfoEx
    {
        internal StartupInfo StartupInfo;
        internal IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobObjectBasicLimitInformation
    {
        internal long PerProcessUserTimeLimit;
        internal long PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize;
        internal UIntPtr MaximumWorkingSetSize;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass;
        internal uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct IoCounters
    {
        internal ulong ReadOperationCount;
        internal ulong WriteOperationCount;
        internal ulong OtherOperationCount;
        internal ulong ReadTransferCount;
        internal ulong WriteTransferCount;
        internal ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobObjectExtendedLimitInformation
    {
        internal JobObjectBasicLimitInformation BasicLimitInformation;
        internal IoCounters IoInfo;
        internal UIntPtr ProcessMemoryLimit;
        internal UIntPtr JobMemoryLimit;
        internal UIntPtr PeakProcessMemoryUsed;
        internal UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobObjectBasicAccountingInformation
    {
        internal long TotalUserTime;
        internal long TotalKernelTime;
        internal long ThisPeriodTotalUserTime;
        internal long ThisPeriodTotalKernelTime;
        internal uint TotalPageFaultCount;
        internal uint TotalProcesses;
        internal uint ActiveProcesses;
        internal uint TotalTerminatedProcesses;
    }
}

internal sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    private SafeJobHandle() : base(true) { }

    protected override bool ReleaseHandle() => NativeMethods.CloseHandle(handle);
}
