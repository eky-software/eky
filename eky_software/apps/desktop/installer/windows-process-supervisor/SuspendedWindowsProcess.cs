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
    internal bool HandlesClosed => Process.IsClosed && thread.IsClosed;

    internal static SuspendedWindowsProcess Start(
        SupervisorRequest request, WindowsJob job, CancellationToken cancellationToken,
        Action<string>? observeCreation = null)
    {
        Observe("preparationStarted");
        cancellationToken.ThrowIfCancellationRequested();
        using var attribute = job.CreateProcessAttribute();
        var startupInfo = new NativeMethods.StartupInfoEx
        {
            StartupInfo = new NativeMethods.StartupInfo
            {
                Size = (uint)Marshal.SizeOf<NativeMethods.StartupInfoEx>(),
            },
            AttributeList = attribute.List,
        };
        var commandLine = new StringBuilder(
            WindowsCommandLine.Build(request.Command, request.Arguments)
        );
        Observe("nativeCallStarted");
        var created = NativeMethods.CreateProcess(
                request.Command,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                NativeMethods.CreateSuspended | NativeMethods.ExtendedStartupInfoPresent,
                IntPtr.Zero,
                request.WorkingDirectory,
                ref startupInfo,
                out var processInformation);
        var creationError = created ? 0 : Marshal.GetLastWin32Error();
        Observe("nativeCallReturned");
        if (!created)
        {
            throw new SupervisorFailure(
                "processStartFailed",
                creationError
            );
        }

        var child = new SuspendedWindowsProcess(
            new SafeProcessHandle(processInformation.Process, true),
            new SafeWaitHandle(processInformation.Thread, true)
        );
        Observe("handlesCaptured");
        return child;

        void Observe(string phase)
        {
            try { observeCreation?.Invoke(phase); }
            catch { /* Measurement must not change native process ownership or its result. */ }
        }
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

    public void Dispose()
    {
        thread.Dispose();
        Process.Dispose();
    }
}
