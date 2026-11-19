using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

// PRIVATE overlay of the current class; normal builds retain the original source.
internal sealed class ProcessCreationJobAttribute : IDisposable
{
    private const nuint HandleListAttribute = 0x00020002;
    private readonly SafeJobHandle job;
    private bool retained;
    private bool initialized;
    private IntPtr jobValue;
    private IntPtr inheritedValue;
    private SafeFileHandle[] inheritedHandles = [];
    private bool[] inheritedRetained = [];
    internal IntPtr List { get; private set; }
    internal int InheritedHandleCount { get; private set; }

    internal ProcessCreationJobAttribute(SafeJobHandle job)
    {
        this.job = job;
        try
        {
            job.DangerousAddRef(ref retained);
            nuint size = 0;
            NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            if (size == 0 || size > int.MaxValue) throw new SupervisorFailure("jobAssignFailed");
            List = Marshal.AllocHGlobal((int)size);
            if (!NativeMethods.InitializeProcThreadAttributeList(List, 2, 0, ref size))
                throw new SupervisorFailure("jobAssignFailed", Marshal.GetLastWin32Error());
            initialized = true;
            jobValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValue, job.DangerousGetHandle());
            if (!NativeMethods.UpdateProcThreadAttribute(
                    List, 0, NativeMethods.JobListAttribute, jobValue, (nuint)IntPtr.Size,
                    IntPtr.Zero, IntPtr.Zero))
                throw new SupervisorFailure("jobAssignFailed", Marshal.GetLastWin32Error());
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    internal void SetInheritedHandles(params SafeFileHandle[] handles)
    {
        if (!initialized || inheritedValue != IntPtr.Zero || handles is null || handles.Length == 0)
            throw new SupervisorFailure("processStartFailed");
        try
        {
            inheritedHandles = (SafeFileHandle[])handles.Clone();
            inheritedRetained = new bool[inheritedHandles.Length];
            inheritedValue = Marshal.AllocHGlobal(checked(inheritedHandles.Length * IntPtr.Size));
            var distinct = new HashSet<IntPtr>();
            for (var index = 0; index < inheritedHandles.Length; index++)
            {
                var handle = inheritedHandles[index];
                if (handle is null || handle.IsInvalid || handle.IsClosed)
                    throw new SupervisorFailure("processStartFailed");
                handle.DangerousAddRef(ref inheritedRetained[index]);
                if (!GetHandleInformation(handle, out var flags))
                    throw new SupervisorFailure("processStartFailed", Marshal.GetLastWin32Error());
                if ((flags & NativeMethods.HandleFlagInherit) == 0 || !distinct.Add(handle.DangerousGetHandle()))
                    throw new SupervisorFailure("processStartFailed");
                Marshal.WriteIntPtr(inheritedValue, index * IntPtr.Size, handle.DangerousGetHandle());
            }
            // Microsoft requires inheritable handles, bInheritHandles=TRUE, and value memory
            // valid until DeleteProcThreadAttributeList, not just until Update returns.
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
            if (!NativeMethods.UpdateProcThreadAttribute(
                    List, 0, HandleListAttribute, inheritedValue,
                    (nuint)(inheritedHandles.Length * IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                throw new SupervisorFailure("processStartFailed", Marshal.GetLastWin32Error());
            InheritedHandleCount = inheritedHandles.Length;
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    public void Dispose()
    {
        if (initialized) NativeMethods.DeleteProcThreadAttributeList(List);
        initialized = false;
        if (List != IntPtr.Zero) Marshal.FreeHGlobal(List);
        List = IntPtr.Zero;
        if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
        jobValue = IntPtr.Zero;
        if (inheritedValue != IntPtr.Zero) Marshal.FreeHGlobal(inheritedValue);
        inheritedValue = IntPtr.Zero;
        for (var index = 0; index < inheritedRetained.Length; index++)
            if (inheritedRetained[index]) inheritedHandles[index].DangerousRelease();
        inheritedHandles = [];
        inheritedRetained = [];
        InheritedHandleCount = 0;
        if (retained) job.DangerousRelease();
        retained = false;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetHandleInformation(SafeFileHandle handle, out uint flags);
}
