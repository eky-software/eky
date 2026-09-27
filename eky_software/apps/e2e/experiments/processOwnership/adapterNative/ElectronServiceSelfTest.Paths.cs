using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class ElectronServiceSelfTest
{
    private static void TestPathsAndPublication()
    {
        var temp = Path.TrimEndingDirectorySeparator(Path.GetTempPath());
        BackendServiceConfiguration.RequireCanonicalPath(temp, true);
        var root = Path.Combine(temp, "eky-e2e", "run-electron-selftest-" + Guid.NewGuid().ToString("N"));
        if (Directory.Exists(root)) throw new AdapterFailure("electronSelfTestFailed");
        Directory.CreateDirectory(root);
        var previousAnchor = Environment.GetEnvironmentVariable("EKY_E2E_OS_TEMP_ROOT");
        var previousGuard = Environment.GetEnvironmentVariable("EKY_E2E");
        string? selector = null;
        try
        {
            var repository = Path.Combine(root, "source");
            var desktop = Path.Combine(repository, "apps", "desktop");
            var applicationDirectory = Path.Combine(desktop, "e2e-dist");
            var applicationManifest = Path.Combine(applicationDirectory, "package.json");
            var applicationMain = Path.Combine(applicationDirectory, "e2e", "electronE2eEntrypoint.js");
            var osTemp = Path.Combine(root, "os-temp");
            var run = Path.Combine(osTemp, "eky-e2e", "run-synthetic");
            var control = Path.Combine(run, "owner");
            var runtime = Path.Combine(run, "worker");
            var package = Path.Combine(repository, "node_modules", ".pnpm", "electron@" + Version, "node_modules", "electron");
            var environment = EnvironmentFor(runtime, Path.Combine(root, "system"));
            var values = Configuration();
            values["repositoryRoot"] = repository; values["osTempRoot"] = osTemp; values["runRoot"] = run;
            values["controlRoot"] = control; values["runtimeRoot"] = runtime;
            values["runtimeConfigPath"] = Path.Combine(runtime, "electron-config.json");
            values["electronExecutable"] = Path.Combine(package, "dist", "electron.exe");
            values["environment"] = environment;
            foreach (var key in environment.Keys.Where(key => key is not ("EKY_E2E" or "NODE_ENV" or "EKY_ELECTRON_E2E_CONFIG")))
                Directory.CreateDirectory(environment[key]);
            Directory.CreateDirectory(control);
            Directory.CreateDirectory(Path.Combine(desktop, "node_modules"));
            Directory.CreateDirectory(Path.GetDirectoryName(applicationMain)!);
            Directory.CreateDirectory(Path.Combine(package, "dist"));
            File.WriteAllBytes(Path.Combine(desktop, "package.json"), DesktopManifest());
            File.WriteAllBytes(applicationManifest, JsonSerializer.SerializeToUtf8Bytes(ApplicationManifest()));
            File.WriteAllText(applicationMain, "// synthetic; never executed");
            File.WriteAllBytes(Path.Combine(package, "package.json"), PackageManifest());
            File.WriteAllText(Path.Combine(package, "path.txt"), "electron.exe\r\n");
            File.WriteAllBytes((string)values["electronExecutable"]!, []);
            File.WriteAllText((string)values["runtimeConfigPath"]!, "{}");
            selector = Path.Combine(desktop, "node_modules", "electron");
            ViteServiceSelfTest.CreateTestJunction(selector, package);
            var configurationPath = Path.Combine(control, "electron-service-config.json");
            File.WriteAllBytes(configurationPath, JsonSerializer.SerializeToUtf8Bytes(values));
            Environment.SetEnvironmentVariable("EKY_E2E_OS_TEMP_ROOT", osTemp);
            var config = ElectronServiceConfiguration.Read(configurationPath);
            Check(config.ElectronExecutable == (string)values["electronExecutable"]!);
            config.ValidatePaths(); Check(true);
            var service = ServiceConfiguration.Read(configurationPath, ServiceProfile.Electron);
            Check(service.Profile == ServiceProfile.Electron && service.Executable == config.ElectronExecutable);
            Check(service.Generation == Generation && service.LaunchNonce == Nonce && service.WorkBudgetMilliseconds == 15000);
            Check(service.WorkingDirectory == run && service.Arguments.SequenceEqual(new[] { Path.Combine(desktop, "e2e-dist") }));
            Check(service.PipeName == config.PipeName && service.ChildEnvironment.Count == 12 && !service.ChildEnvironment.ContainsKey("EKY_E2E_OS_TEMP_ROOT"));
            service.ValidatePaths(); Check(true);
            Reject(() => ServiceConfiguration.Read(configurationPath, ServiceProfile.Backend));
            Reject(() => ServiceConfiguration.Read(configurationPath, ServiceProfile.Vite));

            foreach (var anchor in new[] { null, root, run, osTemp + @"\..\os-temp" })
            {
                Environment.SetEnvironmentVariable("EKY_E2E_OS_TEMP_ROOT", anchor);
                Reject(config.ValidatePaths);
            }
            Environment.SetEnvironmentVariable("EKY_E2E_OS_TEMP_ROOT", osTemp);
            Environment.SetEnvironmentVariable("EKY_E2E", "0");
            Reject(config.ValidatePaths); Reject(() => ElectronServiceConfiguration.Read(configurationPath));
            Environment.SetEnvironmentVariable("EKY_E2E", previousGuard);
            config.ValidatePaths(); Check(true);

            var wrongName = Path.Combine(control, "other.json");
            File.Copy(configurationPath, wrongName);
            Reject(() => ElectronServiceConfiguration.Read(wrongName));
            foreach (var bytes in new[] { Array.Empty<byte>(), new byte[8193], Encoding.UTF8.GetBytes("{}") })
                RejectChangedFile(configurationPath, bytes, config.ValidatePaths);
            RejectChangedFile(configurationPath, JsonSerializer.SerializeToUtf8Bytes(new { generation = Nonce }), service.ValidatePaths);
            RejectChangedFile(config.RuntimeConfigPath, Encoding.UTF8.GetBytes("{\"changed\":true}"), config.ValidatePaths);
            RejectChangedFile(config.RuntimeConfigPath, new byte[32 * 1024 + 1], config.ValidatePaths);
            RejectChangedFile(config.RuntimeConfigPath, [], config.ValidatePaths);
            RejectChangedFile(Path.Combine(desktop, "package.json"),
                JsonSerializer.SerializeToUtf8Bytes(new { devDependencies = new { electron = Version }, changed = true }), config.ValidatePaths);
            RejectChangedFile(Path.Combine(package, "package.json"),
                JsonSerializer.SerializeToUtf8Bytes(new { name = "electron", version = Version, changed = true }), config.ValidatePaths);
            RejectChangedFile(Path.Combine(package, "path.txt"), Encoding.UTF8.GetBytes("electron.exe\n"), config.ValidatePaths);
            RejectChangedFile(Path.Combine(package, "path.txt"), Encoding.UTF8.GetBytes("other.exe"), config.ValidatePaths);
            var changedApplication = ApplicationManifest(); changedApplication["main"] = "e2e/other.js";
            RejectChangedFile(applicationManifest, JsonSerializer.SerializeToUtf8Bytes(changedApplication), config.ValidatePaths);
            RejectChangedFile(applicationManifest, Encoding.UTF8.GetBytes(JsonSerializer.Serialize(ApplicationManifest()) + " "), config.ValidatePaths);
            foreach (var path in new[] { applicationManifest, applicationMain })
            {
                var saved = path + ".synthetic-original";
                File.Move(path, saved);
                try { Reject(config.ValidatePaths); Reject(() => ElectronServiceConfiguration.Read(configurationPath)); }
                finally { File.Move(saved, path); }
            }

            foreach (var path in new[] { Path.Combine(package, "dist", "other.exe"), Path.Combine(desktop, "node_modules", "electron", "dist", "electron.exe") })
                Reject((config with { ElectronExecutable = path }).ValidatePaths);
            foreach (var path in new[] { applicationDirectory, Path.GetDirectoryName(applicationMain)!, control, runtime, environment["TEMP"],
                Path.Combine(desktop, "node_modules"), Path.Combine(package, "dist"), package,
                Path.Combine(repository, "node_modules", ".pnpm") })
                RejectDirectoryLink(path, config.ValidatePaths);
            foreach (var path in new[] { applicationManifest, applicationMain, configurationPath, config.RuntimeConfigPath, Path.Combine(desktop, "package.json"),
                Path.Combine(package, "package.json"), Path.Combine(package, "path.txt"), config.ElectronExecutable })
                RejectFileAsDirectory(path, config.ValidatePaths);
            Directory.Delete(selector);
            Directory.CreateDirectory(selector);
            Reject(config.ValidatePaths);
            Directory.Delete(selector);
            var chain = Path.Combine(desktop, "node_modules", "electron-chain");
            Directory.CreateDirectory(chain);
            try
            {
                ViteServiceSelfTest.CreateTestJunction(selector, chain);
                Directory.Delete(chain);
                ViteServiceSelfTest.CreateTestJunction(chain, package);
                Reject(config.ValidatePaths);
            }
            finally
            {
                if (Directory.Exists(selector)) Directory.Delete(selector);
                Directory.Delete(chain);
                ViteServiceSelfTest.CreateTestJunction(selector, package);
            }
            config.ValidatePaths(); Check(true);
            TestTerminalPublication(config, service);
        }
        finally
        {
            Environment.SetEnvironmentVariable("EKY_E2E_OS_TEMP_ROOT", previousAnchor);
            Environment.SetEnvironmentVariable("EKY_E2E", previousGuard);
            if (selector is not null && Directory.Exists(selector)) Directory.Delete(selector);
            BackendServiceConfiguration.RequireCanonicalPath(root, true);
            Directory.Delete(root, true);
        }
    }

    private static void RejectChangedFile(string path, byte[] bytes, Action validate)
    {
        var original = File.ReadAllBytes(path);
        try { File.WriteAllBytes(path, bytes); Reject(validate); }
        finally { File.WriteAllBytes(path, original); }
    }

    private static void RejectDirectoryLink(string path, Action validate)
    {
        var saved = path + "-synthetic-original";
        Directory.Move(path, saved);
        try { ViteServiceSelfTest.CreateTestJunction(path, saved); Reject(validate); }
        finally
        {
            if (Directory.Exists(path)) Directory.Delete(path);
            Directory.Move(saved, path);
        }
    }

    private static void RejectFileAsDirectory(string path, Action validate)
    {
        var saved = path + ".synthetic-original";
        File.Move(path, saved);
        try { Directory.CreateDirectory(path); Reject(validate); }
        finally { Directory.Delete(path); File.Move(saved, path); }
    }

    private static void TestTerminalPublication(ElectronServiceConfiguration config, ServiceConfiguration service)
    {
        var state = Exited(1); state.BeginStop(); state.ObserveJob(0); state.SetStdioSettled(true);
        var terminal = state.Freeze(true);
        var deadlineChecks = 0;
        service.WriteTerminal(terminal, 1250, () => deadlineChecks++);
        Check(deadlineChecks == 3 && File.Exists(config.TerminalPath) && !File.Exists(config.TerminalPath + ".pending"));
        var bytes = File.ReadAllBytes(config.TerminalPath);
        using var receipt = JsonDocument.Parse(bytes);
        AdapterProtocol.ExactKeys(receipt.RootElement, "protocol", "schemaVersion", "generation", "kind", "state", "cleanupStartedElapsedMilliseconds");
        BackendServiceProtocol.Identity(receipt.RootElement, Generation, ServiceProfile.Electron);
        Check(receipt.RootElement.GetProperty("state").GetProperty("exitCode").GetInt32() == 1 && terminal.FirstFailure is null);
        Check(receipt.RootElement.GetProperty("state").GetProperty("cleanup").GetString() == "processTreeAbsent");
        Reject(() => BackendServiceProtocol.Identity(receipt.RootElement, Generation));
        Reject(() => BackendServiceProtocol.Identity(receipt.RootElement, Generation, ServiceProfile.Vite));
        Reject(() => ElectronServiceConfiguration.Read(config.ConfigurationPath));
        Reject(() => service.WriteTerminal(terminal, 1250, () => { }));
        Check(File.ReadAllBytes(config.TerminalPath).SequenceEqual(bytes));
        File.Delete(config.TerminalPath);
        Reject(() => ElectronServiceConfiguration.Read(config.ConfigurationPath));
        File.Delete(config.TerminalPath + ".pending");
        Reject(() => service.WriteTerminal(terminal, 1250, () => throw new AdapterFailure("cleanupDeadlineExceeded")));
        Check(!File.Exists(config.TerminalPath) && !File.Exists(config.TerminalPath + ".pending"));
        var calls = 0;
        Reject(() => service.WriteTerminal(terminal, 1250,
            () => { if (++calls == 2) throw new AdapterFailure("cleanupDeadlineExceeded"); }));
        Check(!File.Exists(config.TerminalPath) && File.Exists(config.TerminalPath + ".pending"));
    }
}
