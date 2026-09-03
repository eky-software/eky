using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal sealed class SuspendedWindowsProcess : IDisposable
{
    private readonly SafeWaitHandle thread;
    private bool resumed;

    private SuspendedWindowsProcess(
        SafeProcessHandle process,
        SafeWaitHandle thread
    )
    {
        Process = process;
        this.thread = thread;
    }

    internal SafeProcessHandle Process { get; }

    internal static SuspendedWindowsProcess Start(SupervisorRequest request)
    {
        var startupInfo = new NativeMethods.StartupInfo
        {
            Size = (uint)Marshal.SizeOf<NativeMethods.StartupInfo>(),
        };
        var commandLine = new StringBuilder(
            WindowsCommandLine.Build(request.Command, request.Arguments)
        );
        if (!NativeMethods.CreateProcess(
                request.Command,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                NativeMethods.CreateSuspended,
                IntPtr.Zero,
                request.WorkingDirectory,
                ref startupInfo,
                out var processInformation))
        {
            throw new SupervisorFailure(
                "processStartFailed",
                Marshal.GetLastWin32Error()
            );
        }

        return new SuspendedWindowsProcess(
            new SafeProcessHandle(processInformation.Process, true),
            new SafeWaitHandle(processInformation.Thread, true)
        );
    }

    internal void Resume()
    {
        if (resumed || NativeMethods.ResumeThread(thread) == uint.MaxValue)
        {
            throw new SupervisorFailure(
                "processResumeFailed",
                Marshal.GetLastWin32Error()
            );
        }
        resumed = true;
        thread.Dispose();
    }

    internal bool Wait(int milliseconds)
    {
        var result = NativeMethods.WaitForSingleObject(Process, (uint)milliseconds);
        return result switch
        {
            NativeMethods.WaitObject0 => true,
            NativeMethods.WaitTimeout => false,
            _ => throw new SupervisorFailure(
                "processWaitFailed",
                Marshal.GetLastWin32Error()
            ),
        };
    }

    internal int GetExitCode()
    {
        if (!NativeMethods.GetExitCodeProcess(Process, out var exitCode))
        {
            throw new SupervisorFailure(
                "processExitReadFailed",
                Marshal.GetLastWin32Error()
            );
        }
        if (exitCode == NativeMethods.StillActive)
        {
            throw new SupervisorFailure("processExitReadFailed");
        }
        return unchecked((int)exitCode);
    }

    internal void TerminateDirectProcess()
    {
        if (!NativeMethods.TerminateProcess(Process, 1))
        {
            var terminateErrorCode = Marshal.GetLastWin32Error();
            var waitResult = NativeMethods.WaitForSingleObject(Process, 0);
            if (waitResult != NativeMethods.WaitObject0)
            {
                throw new SupervisorFailure(
                    "processTerminateFailed",
                    terminateErrorCode
                );
            }
        }
    }

    public void Dispose()
    {
        thread.Dispose();
        Process.Dispose();
    }
}
