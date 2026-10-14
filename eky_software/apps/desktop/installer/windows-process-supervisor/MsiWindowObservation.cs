using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Eky.WindowsProcessSupervisor;

internal sealed record MsiWindowText(string Role, string Text, bool Enabled);
internal sealed record MsiWindowSample(uint ProcessId, string Status, IReadOnlyList<MsiWindowText> Windows);

// Read-only evidence for the existing optional MSI observation, never readiness.
internal static class MsiWindowObservation
{
    internal sealed record Limits(int SchemaVersion, string Operation, string FilenamePrefix,
        int MaximumBytes, int MaximumClients, int MaximumSamples, int MaximumWindows, int MaximumTextCharacters, int MaximumTotalCharacters,
        int MessageTimeoutMilliseconds, int SampleTimeoutMilliseconds);
    internal static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static readonly Limits Contract = ReadContract();

    private static Limits ReadContract()
    {
        using var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("msiWindowObservationContract.json")!;
        return JsonSerializer.Deserialize<Limits>(source, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    }

    internal static bool IsSystemInstaller(string image) =>
        string.Equals(image, Path.Combine(Environment.SystemDirectory, "msiexec.exe"), StringComparison.OrdinalIgnoreCase);

    internal static MsiWindowSample Capture(WindowsJob job, SafeProcessHandle process, Func<bool> stopped,
        Stopwatch budget, ref int remainingCharacters, ref int remainingWindows)
    {
        var pid = GetProcessId(process);
        var text = new List<MsiWindowText>();
        if (pid == 0 || WorkspaceMsiActivityObservation.ObserveHandle(job, process) != WorkspaceMsiMembership.Owned)
            return new(pid, "unavailable", text);
        var partial = false;
        var slots = remainingWindows;
        var characters = remainingCharacters;
        bool WithinBudget() => !stopped() && budget.ElapsedMilliseconds < Contract.SampleTimeoutMilliseconds;
        bool AllowedClass(IntPtr window, string role)
        {
            var name = new StringBuilder(64);
            if (GetClassName(window, name, name.Capacity) == 0) return false;
            return role switch
            {
                "message" => name.ToString().Equals("Static", StringComparison.OrdinalIgnoreCase),
                "button" => name.ToString().Equals("Button", StringComparison.OrdinalIgnoreCase),
                _ => name.ToString() is "#32770" or "MsiDialogCloseClass" ||
                    name.ToString().Equals("Static", StringComparison.OrdinalIgnoreCase),
            };
        }
        bool Read(IntPtr window, string role)
        {
            if (!WithinBudget() || slots <= 0 || characters <= 0)
            { partial = true; return false; }
            var thread = GetWindowThreadProcessId(window, out var owner);
            if (thread == 0 || owner != pid || !IsWindowVisible(window) || !AllowedClass(window, role)) return true;
            slots--;
            if (WorkspaceMsiActivityObservation.ObserveHandle(job, process) != WorkspaceMsiMembership.Owned)
            { partial = true; return false; }
            var capacity = Math.Min(Contract.MaximumTextCharacters, characters) + 1;
            var value = new StringBuilder(capacity);
            var timeout = (uint)Math.Min(Contract.MessageTimeoutMilliseconds,
                Math.Max(1, Contract.SampleTimeoutMilliseconds - budget.ElapsedMilliseconds));
            var received = SendMessageTimeout(window, 0x000D, (UIntPtr)capacity, value, 0x0002, timeout, out var copied);
            var afterThread = GetWindowThreadProcessId(window, out var afterOwner);
            if (received == IntPtr.Zero || afterThread != thread || afterOwner != pid ||
                !IsWindowVisible(window) || !AllowedClass(window, role))
            { partial = true; return true; }
            if (!WithinBudget()) { partial = true; return false; }
            var message = value.ToString();
            if (copied.ToUInt64() >= (ulong)(capacity - 1)) partial = true;
            if (message.Length > characters) { partial = true; return false; }
            characters -= message.Length;
            text.Add(new(role, message, IsWindowEnabled(window)));
            return true;
        }
        var enumerated = EnumWindows((window, _) =>
        {
            if (!WithinBudget()) { partial = true; return false; }
            GetWindowThreadProcessId(window, out var owner);
            if (owner != pid || !IsWindowVisible(window)) return true;
            if (!Read(window, "title")) return false;
            EnumChildWindows(window, (child, _) =>
            {
                if (!WithinBudget()) { partial = true; return false; }
                GetWindowThreadProcessId(child, out var childOwner);
                if (childOwner != pid || !IsWindowVisible(child)) return true;
                var className = new StringBuilder(64);
                if (GetClassName(child, className, className.Capacity) == 0) { partial = true; return true; }
                // Never request text from Edit/RichEdit, password or custom input controls.
                return className.ToString().ToUpperInvariant() switch
                {
                    "STATIC" => Read(child, "message"),
                    "BUTTON" => Read(child, "button"),
                    _ => true,
                };
            }, IntPtr.Zero);
            return WithinBudget() && slots > 0 && characters > 0;
        }, IntPtr.Zero);
        remainingCharacters = characters;
        remainingWindows = slots;
        if (stopped() || WorkspaceMsiActivityObservation.ObserveHandle(job, process) != WorkspaceMsiMembership.Owned)
            return new(pid, "unavailable", []);
        return new(pid, partial || !enumerated ? "partial" : "observed", text);
    }

    private delegate bool EnumWindow(IntPtr window, IntPtr parameter);
    [DllImport("kernel32.dll")] private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(IntPtr window,
        uint message, UIntPtr wParam, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
}
