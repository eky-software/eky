using Eky.NativeMsiTestAdapter;
using Eky.WindowsProcessSupervisor;
using System.Text.RegularExpressions;

namespace Eky.AdmittedSourceTransport;

internal static class PreparedProductInspection
{
    internal const string Verb = "--joint-reserved-inspection";
    internal const string PassiveVerb = "--joint-passive-product-inspection";
    private const string ReportName = "workspace-inspection-1.json";

    internal static int Run(string[] args)
    {
        var passive = args[0] == PassiveVerb;
        if (!OperatingSystem.IsWindows() || args.Length != (passive ? 3 : 2) ||
            !Path.IsPathFullyQualified(args[^1])) return 64;
        if (passive && (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("GITHUB_JOB") != "packaged-boundary-diagnostic" ||
            Environment.GetEnvironmentVariable("EKY_M51_PASSIVE_SOURCE_MEASUREMENT") != "1")) return 64;
        try
        {
            var report = args[^1];
            var reportName = Path.GetFileName(report);
            if (Path.GetFullPath(report) != report || (passive
                ? !Regex.IsMatch(reportName, @"\Aworkspace-inspection-(?:0|[1-9][0-9]{0,9})\.json\z")
                : reportName != ReportName)) return 64;
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
            var product = passive ? args[1] : "{00000000-0000-0000-0000-000000000001}";
            var code = NativeProductInspection.Run(["--inspect-product", "--product-code",
                product, "--result-path", report], passive ? null : new NativeProductQueries
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
