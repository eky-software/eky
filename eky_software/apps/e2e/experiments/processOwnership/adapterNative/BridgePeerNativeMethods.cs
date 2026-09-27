using System.IO.Pipes;
using System.Runtime.InteropServices;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

internal interface IBridgePeerNativeOperations
{
    bool TryGetConnectedPeerIds(out uint control, out uint output, out uint error);
    SafeProcessHandle OpenProcess(uint access, bool inherit, uint processId);
    uint GetProcessId(SafeProcessHandle process);
    bool TryGetCreationTime(SafeProcessHandle process, out ulong creationTime);
    uint WaitForSingleObject(SafeProcessHandle process, uint milliseconds);
}

internal sealed class BridgePeerNativeOperations(NamedPipeServerStream control, NamedPipeServerStream output,
    NamedPipeServerStream error) : IBridgePeerNativeOperations
{
    public bool TryGetConnectedPeerIds(out uint controlPid, out uint outputPid, out uint errorPid)
    {
        controlPid = outputPid = errorPid = 0;
        if (control is null || output is null || error is null ||
            ReferenceEquals(control, output) || ReferenceEquals(control, error) || ReferenceEquals(output, error) ||
            !control.IsConnected || !output.IsConnected || !error.IsConnected ||
            !control.CanRead || !control.CanWrite || output.CanRead || !output.CanWrite || error.CanRead || !error.CanWrite)
            return false;
        var controlHandle = control.SafePipeHandle;
        var outputHandle = output.SafePipeHandle;
        var errorHandle = error.SafePipeHandle;
        if (controlHandle.IsInvalid || controlHandle.IsClosed || outputHandle.IsInvalid || outputHandle.IsClosed ||
            errorHandle.IsInvalid || errorHandle.IsClosed ||
            controlHandle.DangerousGetHandle() == outputHandle.DangerousGetHandle() ||
            controlHandle.DangerousGetHandle() == errorHandle.DangerousGetHandle() ||
            outputHandle.DangerousGetHandle() == errorHandle.DangerousGetHandle()) return false;
        // The owner retains these exact server instances and must never reconnect them.
        return BridgePeerNativeMethods.GetNamedPipeClientProcessId(controlHandle, out controlPid) &&
            BridgePeerNativeMethods.GetNamedPipeClientProcessId(outputHandle, out outputPid) &&
            BridgePeerNativeMethods.GetNamedPipeClientProcessId(errorHandle, out errorPid);
    }

    public SafeProcessHandle OpenProcess(uint access, bool inherit, uint processId)
        => BridgePeerNativeMethods.OpenProcess(access, inherit, processId);

    public uint GetProcessId(SafeProcessHandle process) => BridgePeerNativeMethods.GetProcessId(process);

    public bool TryGetCreationTime(SafeProcessHandle process, out ulong creationTime)
        => AdapterNativeMethods.GetProcessTimes(process, out creationTime, out _, out _, out _);

    public uint WaitForSingleObject(SafeProcessHandle process, uint milliseconds)
        => NativeMethods.WaitForSingleObject(process, milliseconds);
}

internal static class BridgePeerNativeMethods
{
    internal const uint WaitObject0 = NativeMethods.WaitObject0;
    internal const uint WaitTimeout = NativeMethods.WaitTimeout;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit,
        uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern uint GetProcessId(SafeProcessHandle process);
}
