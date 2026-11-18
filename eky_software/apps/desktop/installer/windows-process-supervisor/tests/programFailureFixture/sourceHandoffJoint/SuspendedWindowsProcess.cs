using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal sealed partial class SuspendedWindowsProcess : IDisposable
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


    internal static SuspendedWindowsProcess StartSource(
        SourceHandoffContext context, WindowsJob job, CancellationToken cancellationToken, string? expectedExecutableSha256)
    {
        cancellationToken.ThrowIfCancellationRequested();
        context.Admission.Verify();
        using var stdin = OpenNull(0x80000000);
        using var stdout = OpenNull(0x40000000);
        using var stderr = OpenNull(0x40000000);
        using var attribute = job.CreateProcessAttribute();
        attribute.SetInheritedHandles(stdin, stdout, stderr);
        var startup = new NativeMethods.StartupInfoEx
        {
            StartupInfo = new NativeMethods.StartupInfo
            {
                Size = (uint)Marshal.SizeOf<NativeMethods.StartupInfoEx>(),
                Flags = 0x00000101,
                StandardInput = stdin.DangerousGetHandle(),
                StandardOutput = stdout.DangerousGetHandle(),
                StandardError = stderr.DangerousGetHandle(),
            },
            AttributeList = attribute.List,
        };
        var root = context.Admission.WorkingDirectory;
        var executable = context.FixturePath is null ? context.Admission.SourceExecutable : context.Request.Command;
        using var imageRoot = context.FixturePath is null
            ? SourceAdmissionFiles.OpenRoot(Path.GetDirectoryName(executable)!) : null;
        using var image = imageRoot?.OpenPinnedExecutable(executable);
        string[] arguments = context.FixturePath is { } fixture
            ? ["--preserve-symlinks", "--preserve-symlinks-main", fixture, "--report", Path.Combine(root, "native-primary.private.json"),
                "--release", Path.Combine(root, "native-primary.release"),
                "--exit-code", context.Case is "exit7" or "exit7CleanupFailure" ? "7" : "0", "--", .. context.SourceArguments]
            : [.. context.SourceArguments];
        if (image is not null)
        {
            var hash = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(image));
            if (hash != expectedExecutableSha256) throw new SupervisorFailure("processStartFailed");
            imageRoot!.VerifyAll();
        }
        var commandLine = WindowsCommandLine.Build(executable, arguments);
        if (commandLine.Length >= 32_767) throw new SupervisorFailure("processStartFailed");
        var block = string.Join('\0', context.Environment.Select(entry => $"{entry.Key}={entry.Value}")) + "\0\0";
        var environment = Marshal.StringToHGlobalUni(block);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var created = NativeMethods.CreateProcess(executable, new StringBuilder(commandLine),
                IntPtr.Zero, IntPtr.Zero, true,
                NativeMethods.CreateSuspended | NativeMethods.ExtendedStartupInfoPresent | 0x08000000 | 0x00000400,
                environment, root, ref startup, out var information);
            var error = created ? 0 : Marshal.GetLastWin32Error();
            if (!created) throw new SupervisorFailure("processStartFailed", error);
            return new SuspendedWindowsProcess(new SafeProcessHandle(information.Process, true),
                new SafeWaitHandle(information.Thread, true));
        }
        finally { Marshal.FreeHGlobal(environment); }
    }

    internal SourceBirthIdentity? SourceBirth { get; private set; }

    internal bool CaptureSourceBirth()
    {
        // Capture only from the retained creation handle, before the owner resumes this source.
        try
        {
            var processId = GetProcessId(Process);
            if (resumed || processId == 0 ||
                !MsiResourceObservation.GetProcessTimes(Process, out var birth, out _, out _, out _) ||
                (birth.Low == 0 && birth.High == 0)) return false;
            SourceBirth = new(processId, birth.Low, birth.High);
            return true;
        }
        catch { return false; }
    }

    internal sealed record SourceBirthIdentity(uint ProcessId, uint StartTimeLow, uint StartTimeHigh);

    internal int GetSourceExitCode()
    {
        if (!Wait(0) || !NativeMethods.GetExitCodeProcess(Process, out var code))
            throw new SupervisorFailure("processExitReadFailed");
        return unchecked((int)code);
    }

    private static SafeFileHandle OpenNull(uint access)
    {
        var security = new SecurityAttributes
        {
            Length = (uint)Marshal.SizeOf<SecurityAttributes>(),
            SecurityDescriptor = IntPtr.Zero,
            InheritHandle = true,
        };
        var handle = CreateFile("NUL", access, 3, ref security, 3, 0, IntPtr.Zero);
        if (!handle.IsInvalid) return handle;
        var error = Marshal.GetLastWin32Error();
        handle.Dispose();
        throw new SupervisorFailure("processStartFailed", error);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        internal uint Length;
        internal IntPtr SecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] internal bool InheritHandle;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        ref SecurityAttributes security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll")]
    private static extern uint GetProcessId(SafeProcessHandle process);

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
        CloseSourceObservationAdmission();
        Exception? first = null;
        try { thread.Dispose(); } catch (Exception error) { first = error; }
        try { Process.Dispose(); } catch (Exception error) { first ??= error; }
        if (first is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(first).Throw();
    }
}
