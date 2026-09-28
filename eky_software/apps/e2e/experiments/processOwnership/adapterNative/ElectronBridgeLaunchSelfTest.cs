using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Pure launch-frame/argv contracts: no files, pipes, process handles or subprocesses.
internal static class ElectronBridgeLaunchSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static int checks;

    internal static int RunChecks()
    {
        checks = 0;
        TestFrame(); TestArguments(); TestFrameBounds();
        return checks;
    }

    private static void Check(bool value) { checks++; if (!value) throw new AdapterFailure("electronBridgeLaunchSelfTestFailed"); }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (AdapterFailure failure)
        {
            Check(failure.Code == "bridgeRegistrationInvalid" && failure.Message == failure.Code && failure.InnerException is null);
            return;
        }
        throw new AdapterFailure("electronBridgeLaunchSelfTestFailed");
    }

    private static ElectronServiceConfiguration Configuration() => new(Generation, Nonce, @"C:\source\electron.exe",
        @"C:\source", @"C:\temp", @"C:\temp\eky-e2e\run-synthetic", @"C:\temp\eky-e2e\run-synthetic\owner",
        @"C:\temp\eky-e2e\run-synthetic\worker\electron-config.json", @"C:\temp\eky-e2e\run-synthetic\worker",
        new Dictionary<string, string>(), 15000, ServiceProfile.ElectronBridge);

    private static string[] Arguments(ElectronServiceConfiguration config) =>
        ["--inspect=0", "--remote-debugging-port=0", config.Entrypoint];

    private static Dictionary<string, object?> Frame(ElectronServiceConfiguration config) => new()
    {
        ["protocol"] = ElectronBridgeServiceProtocol.Name, ["schemaVersion"] = BackendServiceProtocol.Version,
        ["generation"] = config.Generation, ["launchNonce"] = config.LaunchNonce, ["kind"] = "launch",
        ["cwd"] = config.RunRoot, ["args"] = Arguments(config),
    };

    private static void TestFrame()
    {
        var config = Configuration();
        using var original = JsonSerializer.SerializeToDocument(Frame(config));
        var result = ElectronBridgeLaunch.ParseLaunch(original.RootElement, config);
        Check(result.SequenceEqual(Arguments(config)));
        result[0] = "changed";
        Check(ElectronBridgeLaunch.ParseLaunch(original.RootElement, config).SequenceEqual(Arguments(config)));
        foreach (var key in Frame(config).Keys)
        {
            var values = Frame(config); values.Remove(key);
            using var missing = JsonSerializer.SerializeToDocument(values);
            Reject(() => ElectronBridgeLaunch.ParseLaunch(missing.RootElement, config));
            var duplicateJson = "{\"" + key + "\":" + original.RootElement.GetProperty(key).GetRawText() + "," +
                original.RootElement.GetRawText()[1..];
            using var duplicate = JsonDocument.Parse(duplicateJson);
            Reject(() => ElectronBridgeLaunch.ParseLaunch(duplicate.RootElement, config));
        }
        foreach (var (key, invalid) in new (string, object?)[]
        {
            ("protocol", ElectronServiceConfiguration.Protocol), ("protocol", BackendServiceProtocol.Name),
            ("protocol", BridgeRegistrationProtocol.Name), ("schemaVersion", 2), ("schemaVersion", "1"),
            ("generation", Nonce), ("generation", Generation + "\n"), ("launchNonce", Generation), ("launchNonce", null),
            ("kind", "go"), ("kind", "proof"), ("cwd", config.RuntimeRoot), ("cwd", config.RunRoot + "\\"),
            ("cwd", config.RunRoot.ToLowerInvariant()), ("cwd", config.RunRoot + "\\child\\.."),
            ("cwd", "relative"), ("cwd", new string('x', 1025)), ("cwd", config.RunRoot + "\0"), ("cwd", null),
            ("args", null), ("args", "--inspect=0"), ("args", new object?[] { 1, "--remote-debugging-port=0", config.Entrypoint }),
            ("args", new object?[] { "--inspect=0", null, config.Entrypoint }),
            ("environment", new { NODE_OPTIONS = "private" }), ("electronExecutable", config.ElectronExecutable),
            ("workBudgetMilliseconds", 15000), ("workDeadlineElapsedMilliseconds", 15000),
            ("registration", Generation), ("entrypoint", config.Entrypoint), ("extra", "private"),
        })
        {
            var values = Frame(config); values[key] = invalid;
            using var frame = JsonSerializer.SerializeToDocument(values);
            Reject(() => ElectronBridgeLaunch.ParseLaunch(frame.RootElement, config));
        }
        foreach (var json in new[] { "null", "[]", "1", "\"text\"" })
        {
            using var frame = JsonDocument.Parse(json);
            Reject(() => ElectronBridgeLaunch.ParseLaunch(frame.RootElement, config));
        }
        Reject(() => ElectronBridgeLaunch.ParseLaunch(default, config));
        foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite, ServiceProfile.Electron, (ServiceProfile)int.MaxValue })
            Reject(() => ElectronBridgeLaunch.ParseLaunch(original.RootElement, config with { Profile = profile }));
    }

    private static void TestArguments()
    {
        var config = Configuration();
        foreach (var arguments in new string[][]
        {
            [], [config.Entrypoint], ["--inspect=0", "--remote-debugging-port=0"],
            ["--inspect=9229", "--remote-debugging-port=0", config.Entrypoint],
            ["--inspect=0", "--remote-debugging-port=9222", config.Entrypoint],
            ["--remote-debugging-port=0", "--inspect=0", config.Entrypoint],
            ["--inspect=0", "--remote-debugging-port=0", config.Entrypoint, "--no-sandbox"],
            ["-r", @"C:\source\loader.js", "--inspect=0", "--remote-debugging-port=0", config.Entrypoint],
            ["--inspect=0", "--remote-debugging-port=0", "-r", @"C:\source\loader.js", config.Entrypoint],
            ["--inspect=0", "--remote-debugging-port=0", "--require=loader.js"],
            ["--inspect=0", "--remote-debugging-port=0", config.Entrypoint + "\\..\\other"],
            ["--inspect=0", "--remote-debugging-port=0", config.Entrypoint.ToLowerInvariant()],
            ["--inspect=0", "--remote-debugging-port=0", config.Entrypoint + "\\"],
            ["--inspect=0", "--remote-debugging-port=0", '"' + config.Entrypoint + '"'],
            ["--inspect=0", "--remote-debugging-port=0", @"C:\other\e2e-dist"],
            ["--inspect=0", "--remote-debugging-port=0", new string('x', 1025)],
            ["--inspect=0", "--remote-debugging-port=0", config.Entrypoint + "\0private"],
            ["--inspect=0", "--remote-debugging-port=0", null!],
        })
        {
            var before = (string[])arguments.Clone();
            Reject(() => ElectronBridgeLaunch.RequireArguments(arguments, config));
            Check(arguments.SequenceEqual(before));
            var values = Frame(config); values["args"] = arguments;
            using var frame = JsonSerializer.SerializeToDocument(values);
            Reject(() => ElectronBridgeLaunch.ParseLaunch(frame.RootElement, config));
        }
        Reject(() => ElectronBridgeLaunch.RequireArguments(null!, config));
        foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite, ServiceProfile.Electron, (ServiceProfile)int.MaxValue })
            Reject(() => ElectronBridgeLaunch.RequireArguments(Arguments(config), config with { Profile = profile }));
        foreach (var root in new[] { "relative", @"C:\source\..\other", @"\\server\source" })
        {
            var invalid = config with { RepositoryRoot = root };
            Reject(() => ElectronBridgeLaunch.RequireArguments(Arguments(invalid), invalid));
        }
        var spaced = config with { RepositoryRoot = @"C:\synthetic source", RunRoot = @"C:\temp\eky-e2e\run-synthetic space" };
        using var valid = JsonSerializer.SerializeToDocument(Frame(spaced));
        Check(ElectronBridgeLaunch.ParseLaunch(valid.RootElement, spaced).SequenceEqual(Arguments(spaced)));
        Check(config.Arguments.SequenceEqual(new[] { config.Entrypoint }));
    }

    private static void TestFrameBounds()
    {
        var config = Configuration();
        var json = JsonSerializer.Serialize(Frame(config));
        var padding = AdapterProtocol.FrameBytes - 1 - Encoding.UTF8.GetByteCount(json);
        var bounded = json[..^1] + new string(' ', padding) + "}";
        using var maximum = JsonDocument.Parse(bounded);
        Check(ElectronBridgeLaunch.ParseLaunch(maximum.RootElement, config).SequenceEqual(Arguments(config)));
        using var oversized = JsonDocument.Parse(bounded[..^1] + " }");
        Reject(() => ElectronBridgeLaunch.ParseLaunch(oversized.RootElement, config));
    }
}
