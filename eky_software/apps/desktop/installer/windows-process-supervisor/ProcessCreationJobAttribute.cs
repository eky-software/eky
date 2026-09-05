using System.Runtime.InteropServices;

namespace Eky.WindowsProcessSupervisor;

// Keeps the non-inherited Job handle and attribute memory valid for the native creation call.
internal sealed class ProcessCreationJobAttribute : IDisposable
{
    private readonly SafeJobHandle job;
    private bool retained;
    private bool initialized;
    private IntPtr jobValue;
    internal IntPtr List { get; private set; }

    internal ProcessCreationJobAttribute(SafeJobHandle job)
    {
        this.job = job;
        try
        {
            job.DangerousAddRef(ref retained);
            nuint size = 0;
            NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            if (size == 0 || size > int.MaxValue) throw new SupervisorFailure("jobAssignFailed");
            List = Marshal.AllocHGlobal((int)size);
            if (!NativeMethods.InitializeProcThreadAttributeList(List, 1, 0, ref size))
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

    public void Dispose()
    {
        if (initialized) NativeMethods.DeleteProcThreadAttributeList(List);
        initialized = false;
        if (List != IntPtr.Zero) Marshal.FreeHGlobal(List);
        List = IntPtr.Zero;
        if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
        jobValue = IntPtr.Zero;
        if (retained) job.DangerousRelease();
        retained = false;
    }
}
