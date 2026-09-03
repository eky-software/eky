using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal sealed class WindowsJob : IDisposable
{
    private readonly SafeJobHandle handle;

    private WindowsJob(SafeJobHandle handle)
    {
        this.handle = handle;
    }

    internal static WindowsJob Create()
    {
        var handle = NativeMethods.CreateJobObject(IntPtr.Zero, null);
        if (handle.IsInvalid)
        {
            var win32ErrorCode = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new SupervisorFailure("jobCreateFailed", win32ErrorCode);
        }

        if (!NativeMethods.GetHandleInformation(handle, out var handleFlags))
        {
            var win32ErrorCode = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new SupervisorFailure("jobHandlePolicyFailed", win32ErrorCode);
        }
        if ((handleFlags & NativeMethods.HandleFlagInherit) != 0)
        {
            handle.Dispose();
            throw new SupervisorFailure("jobHandlePolicyFailed");
        }

        var limits = new NativeMethods.JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new NativeMethods.JobObjectBasicLimitInformation
            {
                LimitFlags = NativeMethods.JobObjectLimitKillOnJobClose,
            },
        };
        var size = Marshal.SizeOf(limits);
        var pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!NativeMethods.SetInformationJobObject(
                    handle,
                    NativeMethods.JobObjectExtendedLimitInformationClass,
                    pointer,
                    (uint)size))
            {
                throw new SupervisorFailure(
                    "jobConfigureFailed",
                    Marshal.GetLastWin32Error()
                );
            }
        }
        catch (SupervisorFailure)
        {
            handle.Dispose();
            throw;
        }
        catch
        {
            handle.Dispose();
            throw new SupervisorFailure("jobConfigureFailed");
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
        return new WindowsJob(handle);
    }

    internal void Assign(SafeProcessHandle process)
    {
        if (!NativeMethods.AssignProcessToJobObject(handle, process))
        {
            throw new SupervisorFailure(
                "jobAssignFailed",
                Marshal.GetLastWin32Error()
            );
        }
    }

    internal uint GetActiveProcessCount()
    {
        var size = Marshal.SizeOf<NativeMethods.JobObjectBasicAccountingInformation>();
        var pointer = Marshal.AllocHGlobal(size);
        try
        {
            if (!NativeMethods.QueryInformationJobObject(
                    handle,
                    NativeMethods.JobObjectBasicAccountingInformationClass,
                    pointer,
                    (uint)size,
                    out _))
            {
                throw new SupervisorFailure(
                    "jobQueryFailed",
                    Marshal.GetLastWin32Error()
                );
            }
            return Marshal.PtrToStructure<NativeMethods.JobObjectBasicAccountingInformation>(
                pointer
            ).ActiveProcesses;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    internal bool Wait(int milliseconds)
    {
        var result = NativeMethods.WaitForSingleObject(handle, (uint)milliseconds);
        return result switch
        {
            NativeMethods.WaitObject0 => true,
            NativeMethods.WaitTimeout => false,
            _ => throw new SupervisorFailure(
                "jobWaitFailed",
                Marshal.GetLastWin32Error()
            ),
        };
    }

    internal void Terminate()
    {
        if (!NativeMethods.TerminateJobObject(handle, 1))
        {
            throw new SupervisorFailure(
                "jobTerminateFailed",
                Marshal.GetLastWin32Error()
            );
        }
    }

    public void Dispose() => handle.Dispose();
}
