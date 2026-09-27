using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class ViteServiceSelfTest
{
    private static void TestEnvironmentRootPaths()
    {
        var temp = Path.TrimEndingDirectorySeparator(Path.GetTempPath());
        BackendServiceConfiguration.RequireCanonicalPath(temp, true);
        var root = Path.Combine(temp, "eky-e2e", "run-vite-path-selftest-" + Guid.NewGuid().ToString("N"));
        if (Directory.Exists(root)) throw new AdapterFailure("viteSelfTestFailed");
        Directory.CreateDirectory(root);
        var links = new List<string>();
        try
        {
            var repository = Path.Combine(root, "source");
            var osTemp = Path.Combine(root, "os-temp");
            var run = Path.Combine(osTemp, "eky-e2e", "run-synthetic");
            var control = Path.Combine(run, "owner");
            var workerTemp = Path.Combine(run, "worker", "temp");
            var values = Configuration();
            values["repositoryRoot"] = repository;
            values["osTempRoot"] = osTemp;
            values["runRoot"] = run;
            values["controlRoot"] = control;
            values["nodeExecutable"] = Path.Combine(root, "node.exe");
            var environment = (Dictionary<string, string>)values["environment"]!;
            foreach (var key in new[] { "SystemRoot", "WINDIR" }) environment[key] = Path.Combine(root, "system");
            environment["EKY_E2E_OS_TEMP_ROOT"] = osTemp;
            foreach (var key in new[] { "TEMP", "TMP" }) environment[key] = Path.Combine(control, "temp");
            foreach (var key in new[] { "USERPROFILE", "APPDATA", "LOCALAPPDATA" }) environment[key] = Path.Combine(control, "profile");
            environment["EKY_E2E_ENV_ROOT"] = workerTemp;
            foreach (var key in environment.Keys.Where(key => key is not ("EKY_E2E" or "NODE_ENV" or "EKY_E2E_BACKEND_ORIGIN")))
                Directory.CreateDirectory(environment[key]);
            var web = Path.Combine(repository, "apps", "web");
            Directory.CreateDirectory(Path.Combine(web, "node_modules"));
            var package = Path.Combine(repository, "node_modules", ".pnpm", "vite@8.2.1", "node_modules", "vite");
            Directory.CreateDirectory(Path.Combine(package, "bin"));
            File.WriteAllBytes(Path.Combine(package, "package.json"), JsonSerializer.SerializeToUtf8Bytes(Manifest()));
            File.WriteAllText(Path.Combine(package, "bin", "vite.js"), "// synthetic; never executed");
            File.WriteAllText(Path.Combine(web, "vite.config.ts"), "// synthetic; never executed");
            File.WriteAllBytes((string)values["nodeExecutable"]!, []);
            var selector = Path.Combine(web, "node_modules", "vite");
            links.Add(selector); CreateTestJunction(selector, package);
            var configurationPath = Path.Combine(control, "vite-service-config.json");
            File.WriteAllBytes(configurationPath, JsonSerializer.SerializeToUtf8Bytes(values));
            var config = ViteServiceConfiguration.Read(configurationPath);
            Check(config.Environment["EKY_E2E_ENV_ROOT"] == workerTemp && config.Environment["TEMP"] != workerTemp);
            config.ValidatePaths(); Check(true);

            var linkedTemp = Path.Combine(run, "linked-temp");
            links.Add(linkedTemp); CreateTestJunction(linkedTemp, workerTemp);
            var linkedParent = Path.Combine(run, "linked-worker");
            links.Add(linkedParent); CreateTestJunction(linkedParent, Path.GetDirectoryName(workerTemp)!);
            foreach (var path in new[] { linkedTemp, Path.Combine(linkedParent, "temp") })
            {
                var linked = config with { Environment = new Dictionary<string, string>(config.Environment) { ["EKY_E2E_ENV_ROOT"] = path } };
                linked.ValidateLayout(); Check(true);
                Reject(linked.ValidatePaths);
            }
            config.ValidatePaths(); Check(true);
        }
        finally
        {
            foreach (var link in Enumerable.Reverse(links))
                if (Directory.Exists(link)) Directory.Delete(link);
            BackendServiceConfiguration.RequireCanonicalPath(root, true);
            Directory.Delete(root, true);
        }
    }

    // Test-only junctions need neither symlink privilege nor a subprocess. Both ends are synthetic.
    private static void CreateTestJunction(string path, string target)
    {
        BackendServiceConfiguration.RequireCanonicalPath(target, true);
        Directory.CreateDirectory(path);
        var substitute = @"\??\" + target;
        var names = Encoding.Unicode.GetBytes(substitute + '\0' + target + '\0');
        using var data = new MemoryStream();
        using (var writer = new BinaryWriter(data, Encoding.Unicode, leaveOpen: true))
        {
            writer.Write(0xA0000003u); // IO_REPARSE_TAG_MOUNT_POINT
            writer.Write(checked((ushort)(8 + names.Length))); writer.Write((ushort)0);
            writer.Write((ushort)0); writer.Write(checked((ushort)(substitute.Length * 2)));
            writer.Write(checked((ushort)((substitute.Length + 1) * 2))); writer.Write(checked((ushort)(target.Length * 2)));
            writer.Write(names);
        }
        var attributes = new AdapterNativeMethods.SecurityAttributes { Length = Marshal.SizeOf<AdapterNativeMethods.SecurityAttributes>() };
        using var handle = AdapterNativeMethods.CreateFileW(path, 0x40000000, 7, ref attributes, 3, 0x02200000, IntPtr.Zero);
        var buffer = data.ToArray();
        if (handle.IsInvalid || !SetTestReparsePoint(handle, 0x000900A4, buffer, buffer.Length, IntPtr.Zero, 0, out _, IntPtr.Zero))
            throw new AdapterFailure("viteSelfTestFailed");
    }

    [DllImport("kernel32.dll", EntryPoint = "DeviceIoControl", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetTestReparsePoint(SafeFileHandle handle, uint code, byte[] input, int inputSize,
        IntPtr output, int outputSize, out int returned, IntPtr overlapped);
}
