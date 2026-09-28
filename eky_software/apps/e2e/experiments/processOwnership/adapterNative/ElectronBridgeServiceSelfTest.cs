using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Pure schemas/layouts only. No pipes, native handles, files or processes are created.
internal static class ElectronBridgeServiceSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static readonly string Receipt = new('c', 64);

    internal static int RunChecks()
    {
        var checks = 0;
        void Check(bool condition)
        {
            if (!condition) throw new AdapterFailure("electronBridgeSelfTestFailed");
            checks++;
        }
        void Reject(Action action, string? code = null)
        {
            try { action(); }
            catch (AdapterFailure failure) when (code is null || failure.Code == code) { checks++; return; }
            throw new AdapterFailure("electronBridgeSelfTestFailed");
        }
        BackendServiceRequest Parse(Dictionary<string, object?> value, ServiceProfile profile = ServiceProfile.ElectronBridge,
            long previous = 0)
        {
            using var frame = Json(value);
            return BackendServiceProtocol.Request(frame.RootElement, Generation, Nonce, previous, profile);
        }
        Check(ServiceConfiguration.Protocol(ServiceProfile.ElectronBridge) == ElectronBridgeServiceProtocol.Name);
        foreach (var kind in new[] { "arm", "register", "go", "status", "rss", "stop" })
        {
            var value = Request(kind);
            var request = Parse(value);
            Check(request == new BackendServiceRequest(1, kind, kind == "arm" ? 15000 : null,
                kind == "register" ? 7u : null, kind == "go" ? Receipt : null));
            Reject(() => Parse(value, previous: 1), "protocolInvalid");
            Reject(() => Parse(value, previous: -1), "protocolInvalid");
            Reject(() => Parse(value, previous: BackendServiceProtocol.MaximumSequence), "protocolInvalid");
            foreach (var key in value.Keys)
            {
                var missing = new Dictionary<string, object?>(value); missing.Remove(key);
                Reject(() => Parse(missing), "protocolInvalid");
            }
            foreach (var key in new[] { "args", "environment", "cwd", "command", "extra" })
            {
                var extra = new Dictionary<string, object?>(value) { [key] = "rejected" };
                Reject(() => Parse(extra), "protocolInvalid");
            }
            using var duplicate = JsonDocument.Parse(JsonSerializer.Serialize(value)
                .Replace("\"sequence\":1", "\"sequence\":1,\"sequence\":1", StringComparison.Ordinal));
            Reject(() => BackendServiceProtocol.Request(duplicate.RootElement, Generation, Nonce, 0,
                ServiceProfile.ElectronBridge), "protocolInvalid");
            foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite, ServiceProfile.Electron })
            {
                Reject(() => Parse(value, profile), "protocolInvalid");
                var direct = new Dictionary<string, object?>(value) { ["protocol"] = ServiceConfiguration.Protocol(profile) };
                Reject(() => Parse(direct), "protocolInvalid");
                if (kind is "arm" or "register" or "go") Reject(() => Parse(direct, profile), "protocolInvalid");
                else Check(Parse(direct, profile) == new BackendServiceRequest(1, kind, null));
            }
        }
        foreach (var kind in new[] { "launch", "restart", "exec", "started", "armed", "registering", "" })
            Reject(() => Parse(Request(kind)), "protocolInvalid");
        foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite, ServiceProfile.Electron })
        {
            var direct = Request("launch"); direct["protocol"] = ServiceConfiguration.Protocol(profile);
            Check(Parse(direct, profile) == new BackendServiceRequest(1, "launch", 15000));
        }
        foreach (var kind in new[] { "arm", "register", "go", "status", "rss", "stop" })
        foreach (var key in new[] { "launchNonce", "observedBridgePid", "workDeadlineElapsedMilliseconds", "registration" })
        {
            var extra = Request(kind);
            if (extra.ContainsKey(key)) continue;
            extra[key] = key is "launchNonce" or "registration" ? Receipt : 7;
            Reject(() => Parse(extra), "protocolInvalid");
        }
        foreach (var invalid in new object?[] { null, 0, -1, 1.5, "7", true, new[] { 7 }, (long)uint.MaxValue + 1 })
        {
            var value = Request("register"); value["observedBridgePid"] = invalid;
            Reject(() => Parse(value), "protocolInvalid");
        }
        foreach (var pid in new[] { 1u, uint.MaxValue })
        {
            var value = Request("register"); value["observedBridgePid"] = pid;
            Check(Parse(value).ObservedBridgePid == pid);
        }
        foreach (var invalid in new object?[] { null, 0, -1, 1.5, "15000", true, BackendServiceProtocol.MaximumSequence + 1 })
        {
            var value = Request("arm"); value["workDeadlineElapsedMilliseconds"] = invalid;
            Reject(() => Parse(value), "protocolInvalid");
        }
        foreach (var deadline in new[] { 1L, BackendServiceProtocol.MaximumSequence })
        {
            var value = Request("arm"); value["workDeadlineElapsedMilliseconds"] = deadline;
            Check(Parse(value).WorkDeadlineElapsedMilliseconds == deadline);
        }
        foreach (var invalid in new object?[] { null, "", new string('C', 64), new string('c', 63), new string('c', 65),
            new string('g', 64), Receipt + "\n", 7, true, new[] { Receipt } })
        {
            var value = Request("go"); value["registration"] = invalid;
            Reject(() => Parse(value), "protocolInvalid");
        }
        foreach (var pair in new (string Key, object? Value)[]
        {
            ("protocol", ElectronServiceConfiguration.Protocol), ("generation", Nonce), ("launchNonce", Generation),
            ("schemaVersion", 2), ("schemaVersion", "1"), ("sequence", 0), ("sequence", 2), ("sequence", "1"),
        })
        {
            var value = Request("register"); value[pair.Key] = pair.Value;
            Reject(() => Parse(value), "protocolInvalid");
        }
        var last = Request("stop"); last["sequence"] = BackendServiceProtocol.MaximumSequence;
        Check(Parse(last, previous: BackendServiceProtocol.MaximumSequence - 1).Sequence == BackendServiceProtocol.MaximumSequence);

        var state = new BackendServiceState().Snapshot();
        var reply = new BackendServiceReply(ElectronBridgeServiceProtocol.Name, 1, Generation, 1, 1, "status",
            state, null, 200, null, null);
        foreach (var receipt in new string?[] { null, Receipt })
        {
            using var original = JsonSerializer.SerializeToDocument(reply, AdapterProtocol.Json);
            using var projected = JsonSerializer.SerializeToDocument(ElectronBridgeServiceProtocol.Reply(reply, receipt), AdapterProtocol.Json);
            AdapterProtocol.ExactKeys(projected.RootElement, "protocol", "schemaVersion", "generation", "sequence", "replyTo", "kind",
                "state", "rssBytes", "elapsedMilliseconds", "cleanupStartedElapsedMilliseconds", "remainingCleanupMilliseconds", "registration", "bootstrap");
            Check(projected.RootElement.GetProperty("registration").GetString() == receipt);
            Check(projected.RootElement.GetProperty("bootstrap").ValueKind == JsonValueKind.Null);
            foreach (var property in original.RootElement.EnumerateObject())
                Check(property.Value.GetRawText() == projected.RootElement.GetProperty(property.Name).GetRawText());
            Check(!original.RootElement.TryGetProperty("registration", out _));
            Check(!original.RootElement.TryGetProperty("bootstrap", out _));
        }
        foreach (var kind in new[] { "registering", "started", "rss", "rootExit", "terminal" })
        {
            using var projected = JsonSerializer.SerializeToDocument(ElectronBridgeServiceProtocol.Reply(reply with { Kind = kind }, null), AdapterProtocol.Json);
            Check(projected.RootElement.GetProperty("registration").ValueKind == JsonValueKind.Null);
            Check(projected.RootElement.GetProperty("bootstrap").ValueKind == JsonValueKind.Null);
            Reject(() => ElectronBridgeServiceProtocol.Reply(reply with { Kind = kind }, Receipt), "protocolInvalid");
        }
        foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite, ServiceProfile.Electron })
            Reject(() => ElectronBridgeServiceProtocol.Reply(reply with { Protocol = ServiceConfiguration.Protocol(profile) }, null), "protocolInvalid");
        Reject(() => ElectronBridgeServiceProtocol.Reply(reply with { SchemaVersion = 2 }, null), "protocolInvalid");
        Reject(() => ElectronBridgeServiceProtocol.Reply(reply, new string('C', 64)), "protocolInvalid");
        foreach (var closed in new[]
        {
            reply with { State = state with { LaunchClosed = true } },
            reply with { State = state with { FirstFailure = "launchRejected" } },
            reply with { State = state with { Cleanup = "processTreeAbsent" } },
            reply with { CleanupStartedElapsedMilliseconds = 200 },
        }) Reject(() => ElectronBridgeServiceProtocol.Reply(closed, Receipt), "protocolInvalid");

        var bootstrap = new ElectronBridgeBootstrap(200000, 1000).Encode(Generation, Nonce);
        var armed = reply with { Kind = "armed" };
        using (var projected = JsonSerializer.SerializeToDocument(ElectronBridgeServiceProtocol.Reply(armed, null, bootstrap), AdapterProtocol.Json))
        {
            Check(projected.RootElement.GetProperty("bootstrap").GetString() == bootstrap);
            Check(projected.RootElement.GetProperty("registration").ValueKind == JsonValueKind.Null);
        }
        Reject(() => ElectronBridgeServiceProtocol.Reply(armed, null), "protocolInvalid");
        Reject(() => ElectronBridgeServiceProtocol.Reply(armed, Receipt, bootstrap), "protocolInvalid");
        Reject(() => ElectronBridgeServiceProtocol.Reply(armed, null, "{}"), "protocolInvalid");
        Reject(() => ElectronBridgeServiceProtocol.Reply(armed, null, bootstrap.Replace(Generation, Nonce, StringComparison.Ordinal)), "protocolInvalid");
        foreach (var kind in new[] { "status", "registering", "started", "rss", "rootExit", "terminal" })
            Reject(() => ElectronBridgeServiceProtocol.Reply(reply with { Kind = kind }, null, bootstrap), "protocolInvalid");
        foreach (var closed in new[]
        {
            armed with { State = state with { Created = true } },
            armed with { State = state with { Started = true } },
            armed with { State = state with { CreationCompleted = true } },
            armed with { State = state with { LaunchClosed = true } },
            armed with { State = state with { FirstFailure = "launchRejected" } },
            armed with { State = state with { Cleanup = "processTreeAbsent" } },
            armed with { CleanupStartedElapsedMilliseconds = 200 },
        }) Reject(() => ElectronBridgeServiceProtocol.Reply(closed, null, bootstrap), "protocolInvalid");

        using var bridgeDocument = Json(Configuration());
        var bridge = ElectronServiceConfiguration.Parse(bridgeDocument.RootElement, ServiceProfile.ElectronBridge);
        bridge.ValidateLayout(); Check(true);
        Check(bridge.Profile == ServiceProfile.ElectronBridge && bridge.WorkBudgetMilliseconds == 15000);
        Check(bridge.PipeName == "eky-e2e-electron-bridge-v1-" + Generation);
        Check(bridge.ConfigurationPath == Path.Combine(bridge.ControlRoot, "electron-bridge-service-config.json"));
        Check(bridge.TerminalPath == Path.Combine(bridge.ControlRoot, "electron-bridge-service-terminal.json"));
        Check(bridge.Arguments.SequenceEqual(new[] { bridge.Entrypoint }));
        Reject(() => ElectronServiceConfiguration.Parse(bridgeDocument.RootElement));
        Reject(() => BackendServiceConfiguration.Parse(bridgeDocument.RootElement));
        Reject(() => ViteServiceConfiguration.Parse(bridgeDocument.RootElement));
        var directValues = Configuration(); directValues["protocol"] = ElectronServiceConfiguration.Protocol;
        using var directDocument = Json(directValues);
        var electron = ElectronServiceConfiguration.Parse(directDocument.RootElement);
        Check(electron.Profile == ServiceProfile.Electron && electron.PipeName == "eky-e2e-electron-v1-" + Generation);
        Check(electron.ConfigurationPath == Path.Combine(electron.ControlRoot, "electron-service-config.json"));
        Check(electron.TerminalPath == Path.Combine(electron.ControlRoot, "electron-service-terminal.json"));
        Check(electron.Arguments.SequenceEqual(bridge.Arguments) && electron.Environment.SequenceEqual(bridge.Environment));
        Reject(() => ElectronServiceConfiguration.Parse(directDocument.RootElement, ServiceProfile.ElectronBridge));
        foreach (var profile in new[] { ServiceProfile.Backend, ServiceProfile.Vite, (ServiceProfile)int.MaxValue })
        {
            Reject(() => ElectronServiceConfiguration.Parse(bridgeDocument.RootElement, profile), "configurationInvalid");
            var invalid = bridge with { Profile = profile };
            Reject(invalid.ValidateLayout, "configurationInvalid");
            Reject(() => { _ = invalid.ConfigurationPath; }, "configurationInvalid");
        }
        foreach (var key in Configuration().Keys)
        {
            var value = Configuration(); value.Remove(key);
            using var invalid = Json(value); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement, ServiceProfile.ElectronBridge));
        }
        foreach (var key in new[] { "profile", "args", "command", "pipeName", "terminalPath", "cleanupBudgetMilliseconds" })
        {
            var value = Configuration(); value[key] = "rejected";
            using var invalid = Json(value); Reject(() => ElectronServiceConfiguration.Parse(invalid.RootElement, ServiceProfile.ElectronBridge));
        }
        Reject((bridge with { ControlRoot = bridge.RuntimeRoot }).ValidateLayout);
        Reject((bridge with { RuntimeConfigPath = Path.Combine(bridge.ControlRoot, "electron-config.json") }).ValidateLayout);
        var environment = new Dictionary<string, string>(bridge.Environment) { ["NODE_OPTIONS"] = "rejected" };
        Reject((bridge with { Environment = environment }).ValidateLayout);
        Check(BackendServiceProtocol.OperationalFailure(new AdapterFailure("bridgeRegistrationInvalid"), ServiceProfile.ElectronBridge) == "launchRejected");
        foreach (var code in new[] { "bridgePeerIdentityInvalid", "bridgePeerQueryFailed", "bridgePeerMismatch", "bridgePeerOpenFailed",
            "bridgePeerIdentityReadFailed", "bridgePeerIdentityMismatch", "bridgePeerExited", "bridgePeerWaitFailed",
            "bridgePeerDisposed", "bridgePeerObservationFailed" })
        {
            Check(BackendServiceProtocol.OperationalFailure(new AdapterFailure(code), ServiceProfile.ElectronBridge) == "observationLost");
            Check(BackendServiceProtocol.OperationalFailure(new AdapterFailure(code)) == "ownerFailed");
        }
        foreach (var code in BackendServiceProtocol.OperationalFailures)
            Check(BackendServiceProtocol.OperationalFailure(new AdapterFailure(code), ServiceProfile.ElectronBridge) == code);
        Check(BackendServiceProtocol.OperationalFailure(new AdapterFailure("bridgeUnknown"), ServiceProfile.ElectronBridge) == "ownerFailed");
        Check(BackendServiceProtocol.OperationalFailure(new AdapterFailure("bridgeRegistrationInvalid")) == "ownerFailed");
        Check(ElectronBridgeServiceProtocol.OperationalFailure(new AdapterFailure("bridgeTimingInvalid")) == "protocolInvalid");
        checks += ElectronBridgeClockSelfTest.RunChecks();
        return checks;
    }

    private static JsonDocument Json(object value) => JsonSerializer.SerializeToDocument(value);

    private static Dictionary<string, object?> Request(string kind)
    {
        var value = new Dictionary<string, object?>
        {
            ["protocol"] = ElectronBridgeServiceProtocol.Name, ["schemaVersion"] = 1, ["generation"] = Generation,
            ["sequence"] = 1, ["kind"] = kind,
        };
        if (kind is "arm" or "launch") { value["launchNonce"] = Nonce; value["workDeadlineElapsedMilliseconds"] = 15000; }
        if (kind == "register") { value["launchNonce"] = Nonce; value["observedBridgePid"] = 7; }
        if (kind == "go") value["registration"] = Receipt;
        return value;
    }

    private static Dictionary<string, object?> Configuration()
    {
        var runtime = @"C:\temp\eky-e2e\run-synthetic\worker";
        var profile = Path.Combine(runtime, "windows-profile");
        return new()
        {
            ["protocol"] = ElectronBridgeServiceProtocol.Name, ["schemaVersion"] = 1, ["generation"] = Generation,
            ["launchNonce"] = Nonce, ["electronExecutable"] = @"C:\source\electron\electron.exe",
            ["repositoryRoot"] = @"C:\source", ["osTempRoot"] = @"C:\temp", ["runRoot"] = @"C:\temp\eky-e2e\run-synthetic",
            ["controlRoot"] = @"C:\temp\eky-e2e\run-synthetic\owner", ["runtimeRoot"] = runtime,
            ["runtimeConfigPath"] = Path.Combine(runtime, "electron-config.json"), ["workBudgetMilliseconds"] = 15000,
            ["environment"] = new Dictionary<string, string>
            {
                ["EKY_E2E"] = "1", ["NODE_ENV"] = "test", ["SystemRoot"] = @"C:\Windows", ["WINDIR"] = @"C:\Windows",
                ["EKY_ELECTRON_E2E_CONFIG"] = Path.Combine(runtime, "electron-config.json"), ["EKY_ELECTRON_E2E_RUN_ROOT"] = runtime,
                ["HOME"] = profile, ["USERPROFILE"] = profile, ["APPDATA"] = Path.Combine(profile, "AppData", "Roaming"),
                ["LOCALAPPDATA"] = Path.Combine(profile, "AppData", "Local"), ["TEMP"] = Path.Combine(profile, "Temp"), ["TMP"] = Path.Combine(profile, "Temp"),
            },
        };
    }
}
