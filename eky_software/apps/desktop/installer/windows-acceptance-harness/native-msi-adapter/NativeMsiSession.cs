using System.Runtime.InteropServices;
using System.Text;

namespace Eky.NativeMsiTestAdapter;

internal sealed class NativeMsiActionObserver(Func<uint, string> readAction, Action validationStarted)
{
    internal const uint ActionStart = 0x08000000;
    private bool costFinalized;
    internal bool Observed { get; private set; }
    internal bool Valid { get; private set; } = true;

    internal int Handle(uint message, uint record)
    {
        // Never answer FilesInUse/RMFilesInUse with IDOK, IGNORE, or RETRY.
        if ((message & 0xff000000) != ActionStart) return 0;
        try
        {
            var action = readAction(record);
            if (action == "CostFinalize") costFinalized = true;
            if (action == "InstallValidate" && !Observed)
            {
                if (!costFinalized) throw new InvalidOperationException();
                Observed = true;
                validationStarted();
            }
            return 1; // IDOK acknowledges an action notification, not installation success.
        }
        catch
        {
            Valid = false;
            return -1;
        }
    }
}

internal static class NativeMsiSession
{
    internal const uint QuietUi = 2;
    internal const uint MessageFilter = 1u << 8;
    internal const string InstallProperties = "REBOOT=ReallySuppress";
    private const uint VerboseLog = 0x1fff;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate int RecordHandler(nint context, uint message, uint record);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiInstallProductW(string package, string properties);
    [DllImport("msi.dll", ExactSpelling = true)]
    private static extern uint MsiSetInternalUI(uint level, nint window);
    [DllImport("msi.dll", ExactSpelling = true)]
    private static extern uint MsiSetExternalUIRecord(RecordHandler? handler, uint filter, nint context, out nint previous);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiEnableLogW(uint mode, string? path, uint attributes);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiRecordGetStringW(uint record, uint field, StringBuilder value, ref uint length);

    internal static string ReadAction(uint record)
    {
        if (record == 0) throw new InvalidOperationException();
        var value = new StringBuilder(129);
        uint length = 129;
        // Raw record field 1 is the action; formatted message fields differ.
        if (MsiRecordGetStringW(record, 1, value, ref length) != 0 || length is 0 or > 128)
            throw new InvalidOperationException();
        return value.ToString();
    }

    internal static uint Install(string package, string log, NativeMsiActionObserver observer)
    {
        RecordHandler handler = (_, message, record) => observer.Handle(message, record);
        var previousUi = MsiSetInternalUI(QuietUi, nint.Zero);
        if (previousUi == 0) throw new InvalidOperationException();
        try
        {
            if (MsiEnableLogW(VerboseLog, log, 0) != 0 ||
                MsiSetExternalUIRecord(handler, MessageFilter, nint.Zero, out var previous) != 0 || previous != nint.Zero)
                throw new InvalidOperationException();
            return MsiInstallProductW(package, InstallProperties);
        }
        finally
        {
            MsiSetExternalUIRecord(null, 0, nint.Zero, out _);
            MsiEnableLogW(0, null, 0);
            MsiSetInternalUI(previousUi, nint.Zero);
            GC.KeepAlive(handler);
        }
    }
}
