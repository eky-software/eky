using System.Runtime.InteropServices;
using System.Text;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

internal sealed class AdapterProcess : IDisposable
{
    private readonly SafeProcessHandle process;
    private readonly SafeWaitHandle thread;
    private AdapterProcess(NativeMethods.ProcessInformation information)
    {
        process = new SafeProcessHandle(information.Process, true);
        thread = new SafeWaitHandle(information.Thread, true);
    }

    internal static AdapterProcess Create(AdapterConfiguration config, string[] args, WindowsJob job, ChildStandardIo io)
    {
        using var attribute = job.CreateProcessAttribute();
        attribute.SetInheritedHandles(io.Input, io.Output, io.Error);
        var startup = new NativeMethods.StartupInfoEx
        {
            StartupInfo = new NativeMethods.StartupInfo
            {
                Size = (uint)Marshal.SizeOf<NativeMethods.StartupInfoEx>(),
                Flags = 0x00000100, // STARTF_USESTDHANDLES
                StandardInput = io.Input.DangerousGetHandle(),
                StandardOutput = io.Output.DangerousGetHandle(),
                StandardError = io.Error.DangerousGetHandle(),
            },
            AttributeList = attribute.List,
        };
        var block = string.Join('\0', config.Environment.OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)
            .Select(entry => $"{entry.Key}={entry.Value}")) + "\0\0";
        var environment = Marshal.StringToHGlobalUni(block);
        try
        {
            if (!NativeMethods.CreateProcess(config.Electron, new StringBuilder(WindowsCommandLine.Build(config.Electron, args)),
                    IntPtr.Zero, IntPtr.Zero, true,
                    NativeMethods.CreateSuspended | NativeMethods.ExtendedStartupInfoPresent | 0x08000000 | 0x00000400,
                    environment, config.Cwd, ref startup, out var information)) throw new AdapterFailure("processStartFailed");
            return new AdapterProcess(information);
        }
        finally { Marshal.FreeHGlobal(environment); }
    }

    internal void VerifyAndResume(WindowsJob job, AdapterState state)
    {
        if (!job.ContainsProcess(process)) throw new AdapterFailure("jobMembershipFailed");
        state.Assigned();
        if (NativeMethods.ResumeThread(thread) == uint.MaxValue) throw new AdapterFailure("processResumeFailed");
        thread.Dispose();
    }

    internal bool HasExited() => NativeMethods.WaitForSingleObject(process, 0) switch
    {
        NativeMethods.WaitObject0 => true,
        NativeMethods.WaitTimeout => false,
        _ => throw new AdapterFailure("processWaitFailed"),
    };

    internal int ExitCode()
    {
        if (!HasExited() || !NativeMethods.GetExitCodeProcess(process, out var code)) throw new AdapterFailure("processExitReadFailed");
        return unchecked((int)code);
    }

    public void Dispose() { thread.Dispose(); process.Dispose(); }
}

internal sealed class ChildStandardIo : IDisposable
{
    internal SafeFileHandle Input { get; private set; } = new(IntPtr.Zero, true);
    internal SafeFileHandle Output { get; private set; } = new(IntPtr.Zero, true);
    internal SafeFileHandle Error { get; private set; } = new(IntPtr.Zero, true);
    internal FileStream OutputReader { get; private set; } = null!;
    internal FileStream ErrorReader { get; private set; } = null!;

    internal static ChildStandardIo Create()
    {
        var io = new ChildStandardIo();
        try
        {
            var attributes = new AdapterNativeMethods.SecurityAttributes
            {
                Length = Marshal.SizeOf<AdapterNativeMethods.SecurityAttributes>(), InheritHandle = true,
            };
            io.Input = AdapterNativeMethods.CreateFileW("NUL", 0x80000000, 3, ref attributes, 3, 0, IntPtr.Zero);
            if (io.Input.IsInvalid) throw new AdapterFailure("stdioCreateFailed");
            (io.OutputReader, io.Output) = CreateOutput(ref attributes);
            (io.ErrorReader, io.Error) = CreateOutput(ref attributes);
            return io;
        }
        catch { io.Dispose(); throw; }
    }

    private static (FileStream, SafeFileHandle) CreateOutput(ref AdapterNativeMethods.SecurityAttributes attributes)
    {
        if (!AdapterNativeMethods.CreatePipe(out var read, out var write, ref attributes, AdapterProtocol.PipeBufferBytes))
        {
            read?.Dispose(); write?.Dispose();
            throw new AdapterFailure("stdioCreateFailed");
        }
        try
        {
            if (!AdapterNativeMethods.SetHandleInformation(read, NativeMethods.HandleFlagInherit, 0))
                throw new AdapterFailure("handlePolicyFailed");
            return (new FileStream(read, FileAccess.Read, 1, false), write);
        }
        catch { read.Dispose(); write.Dispose(); throw; }
    }

    internal void CloseChildEnds() { Input.Dispose(); Output.Dispose(); Error.Dispose(); }
    public void Dispose() { CloseChildEnds(); OutputReader?.Dispose(); ErrorReader?.Dispose(); }
}
