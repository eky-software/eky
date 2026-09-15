using System.Diagnostics.Tracing;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.NativeMsiTestAdapter;

internal static class NativeProductInspection
{
    internal const int MaximumResultBytes = 64 * 1024;
    internal const string ProviderName = "Eky-InstallerProductInspection-V1";

    internal static int Run(string[] args, NativeProductQueries? queries = null, Action<string>? observation = null)
    {
        EventSource? events = null;
        try { events = new EventSource(ProviderName); } catch { }
        void Observe(string phase)
        {
            try { events?.Write(phase); } catch { }
            try { observation?.Invoke(phase); } catch { }
        }

        // Retain the payload-free stream endpoints for existing trace-reader continuity.
        Observe("scriptStarted");
        string? temporaryPath = null;
        var exitCode = 1;
        try
        {
            if (!OperatingSystem.IsWindows() || args.Length != 5 || args[0] != "--inspect-product" ||
                args[1] != "--product-code" || args[3] != "--result-path" ||
                !Regex.IsMatch(args[2], @"\A\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}\z") ||
                !ValidResultPath(args[4]))
            {
                Observe("requestRejected");
                return 64;
            }
            var resultPath = Path.GetFullPath(args[4]);
            Observe("requestValidated");
            queries ??= new NativeProductQueries();
            Observe("productStateStarted");
            var state = queries.ProductState(args[2]);
            Observe("productStateCompleted");
            // Only the documented product states are facts. INVALIDARG is an error.
            if (state is not (-1 or 1 or 2 or 5)) throw new InvalidOperationException();
            string? name = null, version = null;
            var localPackagePresent = false;
            if (state >= 1)
            {
                Observe("productNameStarted");
                name = queries.ReadProperty(args[2], "ProductName");
                Observe("productNameCompleted");
                Observe("productVersionStarted");
                version = queries.ReadProperty(args[2], "VersionString");
                Observe("productVersionCompleted");
                Observe("localPackageQueryStarted");
                var localPackage = queries.ReadProperty(args[2], "LocalPackage");
                Observe("localPackageQueryCompleted");
                Observe("localPackageCheckStarted");
                localPackagePresent = queries.FilePresent(localPackage);
                Observe("localPackageCheckCompleted");
            }
            Observe("registryInspectionStarted");
            var ownedRegistryExists = queries.RegistryPresent();
            Observe("registryInspectionCompleted");
            Observe("processInspectionStarted");
            var ekyProcessCount = queries.ProcessCount();
            if (ekyProcessCount < 0) throw new InvalidOperationException();
            Observe("processInspectionCompleted");
            Observe("resultSerializeStarted");
            var bytes = JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = 1, productState = state,
                productName = name, productVersion = version, localPackagePresent, ownedRegistryExists, ekyProcessCount });
            if (bytes.Length > MaximumResultBytes) throw new InvalidOperationException();
            Observe("resultSerializeCompleted");
            var candidatePath = resultPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            Observe("resultWriteStarted");
            using (var stream = new FileStream(candidatePath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                temporaryPath = candidatePath;
                stream.Write(bytes);
            }
            Observe("resultWriteCompleted");
            Observe("resultPublishStarted");
            File.Move(temporaryPath, resultPath, overwrite: false);
            temporaryPath = null;
            Observe("resultPublishCompleted");
            exitCode = 0;
        }
        catch { Observe("inspectionFailed"); }
        finally
        {
            try { if (temporaryPath is not null) File.Delete(temporaryPath); }
            catch { exitCode = 1; }
            Observe("scriptFinished");
            try { events?.Dispose(); } catch { }
        }
        return exitCode;
    }

    private static bool ValidResultPath(string path)
    {
        if (!Path.IsPathFullyQualified(path) || path.Contains('\0') ||
            Regex.IsMatch(path, @"(^|[\\/])(?:\.|\.\.)([\\/]|$)") ||
            Path.EndsInDirectorySeparator(path)) return false;
        var fullPath = Path.GetFullPath(path);
        if (!Directory.Exists(Path.GetDirectoryName(fullPath))) return false;
        try { File.GetAttributes(fullPath); return false; }
        catch (FileNotFoundException) { return true; }
        catch (DirectoryNotFoundException) { return false; }
    }
}
