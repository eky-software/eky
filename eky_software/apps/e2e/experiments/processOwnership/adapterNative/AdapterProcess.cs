using System.Runtime.InteropServices;
using System.Text;
using Eky.WindowsProcessSupervisor;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

internal sealed class AdapterProcess : IDisposable
{
    private readonly SafeProcessHandle process;
    private readonly SafeWaitHandle thread;
    private readonly uint processId;
    private AdapterProcess(NativeMethods.ProcessInformation information)
    {
        process = new SafeProcessHandle(information.Process, true);
        thread = new SafeWaitHandle(information.Thread, true);
        processId = information.ProcessId;
    }

    internal static AdapterProcess Create(AdapterConfiguration config, string[] args, WindowsJob job, ChildStandardIo io)
        => Create(config.Electron, args, config.Cwd, config.Environment, job, io);

    internal static AdapterProcess CreateService(ServiceConfiguration config, WindowsJob job, ChildStandardIo io,
        BackendServiceState state)
        => Create(config.Executable, config.Arguments, config.WorkingDirectory, config.ChildEnvironment, job, io, state.MarkCreated);

    internal static AdapterProcess CreateElectronBridge(ServiceConfiguration config, string[] arguments, WindowsJob job,
        ChildStandardIo io, BackendServiceState state)
    {
        if (!config.IsElectronBridge) throw new AdapterFailure("launchRejected");
        ElectronBridgeLaunch.RequireArguments(arguments, config.ElectronConfiguration!);
        return Create(config.Executable, arguments, config.WorkingDirectory, config.ChildEnvironment, job, io, state.MarkCreated);
    }

    private static AdapterProcess Create(string executable, string[] args, string cwd,
        IReadOnlyDictionary<string, string> variables, WindowsJob job, ChildStandardIo io, Action? created = null)
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
        var block = string.Join('\0', variables.OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)
            .Select(entry => $"{entry.Key}={entry.Value}")) + "\0\0";
        var environment = Marshal.StringToHGlobalUni(block);
        try
        {
            if (!NativeMethods.CreateProcess(executable, new StringBuilder(WindowsCommandLine.Build(executable, args)),
                    IntPtr.Zero, IntPtr.Zero, true,
                    NativeMethods.CreateSuspended | NativeMethods.ExtendedStartupInfoPresent | 0x08000000 | 0x00000400,
                    environment, cwd, ref startup, out var information)) throw new AdapterFailure("processStartFailed");
            created?.Invoke();
            return new AdapterProcess(information);
        }
        finally { Marshal.FreeHGlobal(environment); }
    }

    internal void VerifyAndResume(WindowsJob job, AdapterState state)
        => VerifyAndResume(job, state.Assigned);

    internal void VerifyAndResume(WindowsJob job, BackendServiceState state,
        Func<SafeWaitHandle, uint>? resumeThread = null)
    {
        try { VerifyAndResume(job, state.Assigned, resumeThread); }
        catch (SupervisorFailure) { throw new AdapterFailure("jobMembershipFailed"); }
    }

    private void VerifyAndResume(WindowsJob job, Action assigned, Func<SafeWaitHandle, uint>? resumeThread = null)
    {
        if (!job.ContainsProcess(process)) throw new AdapterFailure("jobMembershipFailed");
        assigned();
        if ((resumeThread is null ? NativeMethods.ResumeThread(thread) : resumeThread(thread)) == uint.MaxValue)
            throw new AdapterFailure("processResumeFailed");
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

    internal BackendServiceIdentity ReadBackendIdentity()
    {
        if (processId == 0 || !AdapterNativeMethods.GetProcessTimes(process, out var created, out _, out _, out _) || created == 0)
            throw new AdapterFailure("processIdentityFailed");
        return new(processId, created.ToString("x16", System.Globalization.CultureInfo.InvariantCulture));
    }

    internal long ReadBackendRss()
    {
        var counters = new AdapterNativeMethods.ProcessMemoryCounters
        { Size = (uint)Marshal.SizeOf<AdapterNativeMethods.ProcessMemoryCounters>() };
        if (HasExited() || !AdapterNativeMethods.K32GetProcessMemoryInfo(process, ref counters, counters.Size) || HasExited() ||
            counters.WorkingSetSize == 0 || (ulong)counters.WorkingSetSize > (ulong)BackendServiceProtocol.MaximumSequence)
            throw new AdapterFailure("observationLost");
        return checked((long)counters.WorkingSetSize);
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
