using System.Runtime.InteropServices;
using System.IO.Pipes;
using System.Text.Json;
using Eky.NativeMsiTestAdapter;

internal static class NativeMsiAdapterContract
{
    internal static async Task<int> Run(string encoded)
    {
        using var request = JsonDocument.Parse(Convert.FromBase64String(encoded));
        var value = request.RootElement;
        var mode = value.GetProperty("mode").GetString()!;
        if (mode == "unknownField")
        {
            using var pipe = new NamedPipeClientStream(".", value.GetProperty("pipe").GetString()!, PipeDirection.Out);
            await pipe.ConnectAsync();
            await pipe.WriteAsync(JsonSerializer.SerializeToUtf8Bytes(new {
                schemaVersion = 1, nonce = value.GetProperty("nonce").GetString(),
                phase = "installValidate", unexpected = true,
            }));
            await pipe.WriteAsync(new byte[] { 10 });
            return 0;
        }
        Require(NativeMsiSession.QuietUi == 2 && NativeMsiSession.MessageFilter == 0x100 &&
            NativeMsiSession.InstallProperties == "REBOOT=ReallySuppress");
        return await NativeMsiProgram.Run(value.GetProperty("pipe").GetString()!,
            value.GetProperty("nonce").GetString()!, observer =>
            {
                // Real MSI records prove the raw field boundary without installing a package.
                if (observer.Handle(0x19000000, 0) != 0) throw new InvalidOperationException();
                if (mode == "misordered")
                {
                    Action(observer, "InstallValidate", -1);
                    return 1603;
                }
                if (mode == "invalidRecord")
                {
                    if (observer.Handle(NativeMsiActionObserver.ActionStart, 0) != -1)
                        throw new InvalidOperationException();
                    return 1603;
                }
                Action(observer, "CostFinalize", 1);
                if (mode == "wrongField")
                {
                    Action(observer, "InstallFiles", 1, "InstallValidate");
                    return 0;
                }
                if (mode == "missing") return 0;
                if (mode is not ("valid" or "msiFailure")) throw new InvalidOperationException();
                Action(observer, "InstallValidate", 1);
                Action(observer, "InstallValidate", 1);
                return mode == "msiFailure" ? 1603u : 0u;
            });
    }

    private static void Require(bool condition)
    {
        if (!condition) throw new InvalidOperationException();
    }

    private static void Action(NativeMsiActionObserver observer, string action, int expected, string description = "")
    {
        var record = MsiCreateRecord(3);
        if (record == 0) throw new InvalidOperationException();
        try
        {
            if (MsiRecordSetStringW(record, 1, action) != 0 || MsiRecordSetStringW(record, 2, description) != 0 ||
                observer.Handle(NativeMsiActionObserver.ActionStart, record) != expected)
                throw new InvalidOperationException();
        }
        finally { MsiCloseHandle(record); }
    }

    [DllImport("msi.dll")] private static extern uint MsiCreateRecord(uint fields);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiRecordSetStringW(uint record, uint field, string value);
    [DllImport("msi.dll")] private static extern uint MsiCloseHandle(uint record);
}
