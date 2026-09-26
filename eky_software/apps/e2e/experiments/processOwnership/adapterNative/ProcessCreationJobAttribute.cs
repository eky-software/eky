using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using Eky.ProcessOwnershipAdapter;

namespace Eky.WindowsProcessSupervisor;

// Experiment-only replacement. The linked production WindowsJob keeps its constructor contract.
internal sealed class ProcessCreationJobAttribute : IDisposable
{
    internal const int AttributeCapacity = 2;
    internal const int HandleListAttribute = 0x00020002;
    private readonly SafeJobHandle job;
    private bool retained;
    private bool initialized;
    private IntPtr jobValue;
    private IntPtr handleValues;
    private readonly List<SafeFileHandle> inheritedHandles = [];
    internal IntPtr List { get; private set; }

    internal ProcessCreationJobAttribute(SafeJobHandle job)
    {
        this.job = job;
        try
        {
            job.DangerousAddRef(ref retained);
            nuint size = 0;
            NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, AttributeCapacity, 0, ref size);
            if (size == 0 || size > int.MaxValue) throw new AdapterFailure("jobAssignFailed");
            List = Marshal.AllocHGlobal((int)size);
            if (!NativeMethods.InitializeProcThreadAttributeList(List, AttributeCapacity, 0, ref size))
                throw new AdapterFailure("jobAssignFailed");
            initialized = true;
            jobValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValue, job.DangerousGetHandle());
            if (!NativeMethods.UpdateProcThreadAttribute(List, 0, NativeMethods.JobListAttribute,
                    jobValue, (nuint)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) throw new AdapterFailure("jobAssignFailed");
        }
        catch { Dispose(); throw; }
    }

    internal void SetInheritedHandles(SafeFileHandle input, SafeFileHandle output, SafeFileHandle error)
    {
        if (!initialized || handleValues != IntPtr.Zero) throw new AdapterFailure("handlePolicyFailed");
        var handles = new[] { input, output, error };
        ValidateHandleList(handles.Select(handle => handle.DangerousGetHandle()).ToArray(), job.DangerousGetHandle());
        try
        {
            foreach (var handle in handles)
            {
                if (handle.IsClosed || handle.IsInvalid || !AdapterNativeMethods.GetHandleInformation(handle, out var flags) ||
                    (flags & NativeMethods.HandleFlagInherit) == 0) throw new AdapterFailure("handlePolicyFailed");
                var added = false;
                handle.DangerousAddRef(ref added);
                if (added) inheritedHandles.Add(handle);
            }
            handleValues = Marshal.AllocHGlobal(IntPtr.Size * handles.Length);
            for (var index = 0; index < handles.Length; index++)
                Marshal.WriteIntPtr(handleValues, index * IntPtr.Size, handles[index].DangerousGetHandle());
            if (!NativeMethods.UpdateProcThreadAttribute(List, 0, HandleListAttribute, handleValues,
                    (nuint)(IntPtr.Size * handles.Length), IntPtr.Zero, IntPtr.Zero)) throw new AdapterFailure("handlePolicyFailed");
        }
        catch { Dispose(); throw; }
    }

    internal static void ValidateHandleList(IReadOnlyList<IntPtr> handles, IntPtr jobHandle)
    {
        if (handles.Count != 3 || handles.Any(handle => handle == IntPtr.Zero || handle == new IntPtr(-1) || handle == jobHandle) ||
            handles.Distinct().Count() != 3) throw new AdapterFailure("handlePolicyFailed");
    }

    public void Dispose()
    {
        if (initialized) NativeMethods.DeleteProcThreadAttributeList(List);
        initialized = false;
        if (List != IntPtr.Zero) Marshal.FreeHGlobal(List);
        List = IntPtr.Zero;
        if (handleValues != IntPtr.Zero) Marshal.FreeHGlobal(handleValues);
        handleValues = IntPtr.Zero;
        if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
        jobValue = IntPtr.Zero;
        foreach (var handle in inheritedHandles) handle.DangerousRelease();
        inheritedHandles.Clear();
        if (retained) job.DangerousRelease();
        retained = false;
    }
}
