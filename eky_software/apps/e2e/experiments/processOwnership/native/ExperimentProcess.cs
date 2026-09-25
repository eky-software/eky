using System.Runtime.InteropServices;
using System.Text;
using System.Collections;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipExperiment;

// Isolated feasibility launcher: no installer request/result protocol is used.
internal sealed class ExperimentProcess : IDisposable
{
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private readonly SafeProcessHandle process;
    private readonly SafeWaitHandle thread;

    private ExperimentProcess(NativeMethods.ProcessInformation information)
    {
        process = new SafeProcessHandle(information.Process, true);
        thread = new SafeWaitHandle(information.Thread, true);
    }

    internal static ExperimentProcess Start(string node, string fixture, string directory, WindowsJob job)
    {
        using var attribute = job.CreateProcessAttribute();
        var startup = new NativeMethods.StartupInfoEx
        {
            StartupInfo = new NativeMethods.StartupInfo
            {
                Size = (uint)Marshal.SizeOf<NativeMethods.StartupInfoEx>(),
            },
            AttributeList = attribute.List,
        };
        var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
            environment[(string)entry.Key] = (string)entry.Value!;
        environment["EKY_T3A_TEMP_BASE"] = Path.GetTempPath();
        environment["TEMP"] = Path.Combine(directory, "tmp");
        environment["TMP"] = environment["TEMP"];
        var block = string.Join('\0', environment.Select(entry => $"{entry.Key}={entry.Value}")) + "\0\0";
        var environmentPointer = Marshal.StringToHGlobalUni(block);
        try
        {
            if (!NativeMethods.CreateProcess(node, new StringBuilder(WindowsCommandLine.Build(node, [fixture])),
                    IntPtr.Zero, IntPtr.Zero, false,
                    NativeMethods.CreateSuspended | NativeMethods.ExtendedStartupInfoPresent | CreateNoWindow | CreateUnicodeEnvironment,
                    environmentPointer, directory, ref startup, out var information))
                throw new SupervisorFailure("processStartFailed", Marshal.GetLastWin32Error());
            return new ExperimentProcess(information);
        }
        finally { Marshal.FreeHGlobal(environmentPointer); }
    }

    internal bool IsOwnedBy(WindowsJob job) => job.ContainsProcess(process);

    internal void Resume()
    {
        if (NativeMethods.ResumeThread(thread) == uint.MaxValue)
            throw new SupervisorFailure("processResumeFailed", Marshal.GetLastWin32Error());
        thread.Dispose();
    }

    internal bool HasExited()
    {
        return NativeMethods.WaitForSingleObject(process, 0) switch
        {
            NativeMethods.WaitObject0 => true,
            NativeMethods.WaitTimeout => false,
            _ => throw new SupervisorFailure("processWaitFailed", Marshal.GetLastWin32Error()),
        };
    }

    internal int ExitCode()
    {
        if (!HasExited() || !NativeMethods.GetExitCodeProcess(process, out var code))
            throw new SupervisorFailure("processExitReadFailed");
        return unchecked((int)code);
    }

    public void Dispose()
    {
        thread.Dispose();
        process.Dispose();
    }
}
