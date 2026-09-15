using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Eky.NativeMsiTestAdapter;

internal delegate uint ReadProductInfo(string product, string property, StringBuilder? buffer, ref uint length);

// Read-only MSI facts. Installation, policy and process cleanup stay with the caller.
internal sealed class NativeProductQueries
{
    internal Func<string, int> ProductState { get; init; } = MsiQueryProductStateW;
    internal ReadProductInfo ProductInfo { get; init; } = MsiGetProductInfoW;
    internal Func<string, bool> FilePresent { get; init; } = IsFile;
    internal Func<bool> RegistryPresent { get; init; } = InspectRegistry;
    internal Func<int> ProcessCount { get; init; } = InspectProcesses;

    internal string ReadProperty(string product, string property)
    {
        uint length = 0;
        var result = ProductInfo(product, property, null, ref length);
        // The first call negotiates the buffer only; the second must succeed completely.
        if (result is not (0 or 234) || length > NativeProductInspection.MaximumResultBytes) throw new InvalidOperationException();
        var buffer = new StringBuilder(checked((int)length + 1));
        length = (uint)buffer.Capacity;
        result = ProductInfo(product, property, buffer, ref length);
        // A changing value or failed query is not successful absence; no blind retry.
        if (result != 0 || length >= buffer.Capacity || length != buffer.Length) throw new InvalidOperationException();
        return buffer.ToString();
    }

    private static bool IsFile(string path)
    {
        if (path.Length == 0) return false;
        try { return (File.GetAttributes(path) & FileAttributes.Directory) == 0; }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
    }

    private static bool InspectRegistry()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Eky\Installer", writable: false);
        return key is not null;
    }

    private static int InspectProcesses()
    {
        var processes = Process.GetProcessesByName("Eky");
        try { return processes.Length; }
        finally { foreach (var process in processes) process.Dispose(); }
    }

    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int MsiQueryProductStateW(string product);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiGetProductInfoW(string product, string property, StringBuilder? buffer, ref uint length);
}
