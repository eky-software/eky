using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Eky.WindowsProcessSupervisor;

// Windows' provider owns the returned strings. LB_GETTEXT cannot bound its output
// buffer if a list item changes between the length query and the text query.
[SupportedOSPlatform("windows")]
internal static class MsiApplicationListObservation
{
    private const int ProcessIdProperty = 30002;
    private const int ControlTypeProperty = 30003;
    private const int NameProperty = 30005;
    private const int ListControlType = 50008;
    private const int ListItemControlType = 50007;

    internal static IReadOnlyList<string> Read(IntPtr window, uint processId,
        Func<bool> admitted, Func<int> remainingMilliseconds, int maximumItems, int maximumCharacters, out bool partial)
    {
        var result = new List<string>();
        partial = false;
        object? automationObject = null;
        IElement? root = null;
        IWalker? walker = null;
        IElement? item = null;
        try
        {
            if (maximumItems <= 0 || maximumCharacters <= 0 || !admitted()) { partial = true; return result; }
            automationObject = Activator.CreateInstance(Type.GetTypeFromCLSID(
                new Guid("e22ad333-b25f-460c-83d0-0581107395c9"), throwOnError: true)!);
            var automation = (IAutomation)automationObject!;
            automation.SetAutoFocus(false);
            bool Ready()
            {
                var remaining = remainingMilliseconds();
                if (remaining <= 0 || !admitted()) return false;
                var timeout = (uint)Math.Min(MsiWindowObservation.Contract.MessageTimeoutMilliseconds, remaining);
                automation.SetConnectionTimeout(timeout);
                automation.SetTransactionTimeout(timeout);
                return admitted();
            }
            if (!Ready()) { partial = true; return result; }
            root = automation.FromHandle(window);
            if (!Ready() || root.Property(ProcessIdProperty) is not int owner || (uint)owner != processId ||
                !Ready() || root.Property(ControlTypeProperty) is not int kind || kind != ListControlType)
            { partial = true; return result; }
            if (!Ready()) { partial = true; return result; }
            walker = automation.RawWalker();
            if (!Ready()) { partial = true; return result; }
            item = walker.FirstChild(root);
            var remaining = maximumCharacters;
            while (item is not null)
            {
                if (!admitted() || result.Count >= maximumItems || remaining <= 0)
                { partial = true; break; }
                if (!Ready() || item.Property(ProcessIdProperty) is not int itemOwner || (uint)itemOwner != processId ||
                    !Ready() || item.Property(ControlTypeProperty) is not int itemKind || itemKind != ListItemControlType)
                { partial = true; break; }
                if (!Ready()) { partial = true; break; }
                var name = item.Property(NameProperty) as string;
                if (!admitted() || name is null) { partial = true; break; }
                var length = Math.Min(MsiWindowObservation.Contract.MaximumTextCharacters, remaining);
                if (name.Length > length) { name = name[..length]; partial = true; }
                result.Add(name);
                remaining -= name.Length;
                if (result.Count >= maximumItems || remaining <= 0 || !Ready()) { partial = true; break; }
                var next = walker.NextSibling(item);
                Release(item);
                item = next;
            }
            if (!admitted()) { partial = true; result.Clear(); }
        }
        catch (Exception error) when (error is COMException or InvalidCastException or ArgumentException)
        { partial = true; result.Clear(); }
        finally { Release(item); Release(walker); Release(root); Release(automationObject); }
        return result;
    }

    private static void Release(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    // Exact read-only slots from the Windows SDK UIAutomationClient.idl. Gaps
    // deliberately omit focus, input patterns, desktop search and event APIs.
    [ComImport, Guid("34723aff-0c9d-49d0-9896-7ab52df8cd8a"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAutomation
    {
        void _VtblGap1_3();
        IElement FromHandle(IntPtr window);
        void _VtblGap2_9();
        IWalker RawWalker();
        void _VtblGap3_42();
        void SetAutoFocus([MarshalAs(UnmanagedType.Bool)] bool enabled);
        void _VtblGap4_1();
        void SetConnectionTimeout(uint milliseconds);
        void _VtblGap5_1();
        void SetTransactionTimeout(uint milliseconds);
    }

    [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IElement
    {
        void _VtblGap1_7();
        [return: MarshalAs(UnmanagedType.Struct)] object Property(int propertyId);
    }

    [ComImport, Guid("4042c624-389c-4afc-a630-9df854a541fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IWalker
    {
        void _VtblGap1_1();
        IElement? FirstChild(IElement element);
        void _VtblGap2_1();
        IElement? NextSibling(IElement element);
    }
}
