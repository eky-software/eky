using Eky.NativeMsiTestAdapter;
using Eky.WindowsProcessSupervisor;

namespace Eky.AdmittedSourceTransport;

// The alternate test fixture never queries the installed product or processes.
internal static class PreparedProductInspection
{
    internal const string Verb = "--joint-reserved-inspection";
    private const string ReportName = "workspace-inspection-1.json";

    internal static int Run(string[] args)
    {
        if (!OperatingSystem.IsWindows() || args.Length != 2 || !Path.IsPathFullyQualified(args[1])) return 64;
        try
        {
            var report = args[1];
            if (Path.GetFullPath(report) != report || Path.GetFileName(report) != ReportName) return 64;
            var scenario = Path.GetDirectoryName(report)!;
            var root = Path.GetDirectoryName(scenario);
            var temp = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
            if (root is null || Path.GetDirectoryName(root) != temp || Path.GetFileName(scenario) != "scenario") return 64;
            var prefix = SourceBootstrapProjection.Read().WorkspaceRunRootPrefix;
            var name = Path.GetFileName(root);
            if (!name.StartsWith(prefix, StringComparison.Ordinal) || name.Length != prefix.Length + 6 ||
                !name[prefix.Length..].All(char.IsAsciiLetterOrDigit)) return 64;
            using var pins = SourceAdmissionFiles.OpenRoot(temp);
            pins.PinChildDirectory(root);
            pins.PinChildDirectory(scenario);
            pins.VerifyAll();
            var code = NativeProductInspection.Run(["--inspect-product", "--product-code",
                "{00000000-0000-0000-0000-000000000001}", "--result-path", report], new NativeProductQueries
                {
                    ProductState = _ => -1,
                    RegistryPresent = () => false,
                    ProcessCount = () => 0,
                }, publishInReservedFixture: true);
            pins.VerifyAll();
            return code;
        }
        catch { return 1; }
    }
}
