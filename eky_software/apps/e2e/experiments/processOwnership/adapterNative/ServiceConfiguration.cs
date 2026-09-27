using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal enum ServiceProfile { Backend, Vite, Electron, ElectronBridge }

// Closed launch profiles share the existing owner, control, state and deadlines.
internal sealed class ServiceConfiguration
{
    private readonly BackendServiceConfiguration? backend;
    private readonly ViteServiceConfiguration? vite;
    private readonly ElectronServiceConfiguration? electron;
    private readonly string? runtimeSession;

    private ServiceConfiguration(BackendServiceConfiguration value) { backend = value; }
    private ServiceConfiguration(ViteServiceConfiguration value, string session) { vite = value; runtimeSession = session; }
    private ServiceConfiguration(ElectronServiceConfiguration value) { electron = value; }

    internal ServiceProfile Profile => electron?.Profile ?? (vite is not null ? ServiceProfile.Vite : ServiceProfile.Backend);
    internal bool IsElectronBridge => Profile == ServiceProfile.ElectronBridge;
    internal ElectronServiceConfiguration ElectronConfiguration => electron ?? throw new AdapterFailure("configurationInvalid");
    internal static string Protocol(ServiceProfile profile) => profile switch
    {
        ServiceProfile.Backend => BackendServiceProtocol.Name,
        ServiceProfile.Vite => ViteServiceConfiguration.Protocol,
        ServiceProfile.Electron => ElectronServiceConfiguration.Protocol,
        ServiceProfile.ElectronBridge => ElectronBridgeServiceProtocol.Name,
        _ => throw new AdapterFailure("protocolInvalid"),
    };
    internal string Generation => electron?.Generation ?? vite?.Generation ?? backend!.Generation;
    internal string LaunchNonce => electron?.LaunchNonce ?? vite?.LaunchNonce ?? backend!.LaunchNonce;
    internal string Executable => electron?.ElectronExecutable ?? vite?.NodeExecutable ?? backend!.NodeExecutable;
    internal int WorkBudgetMilliseconds => electron?.WorkBudgetMilliseconds ?? vite?.WorkBudgetMilliseconds ?? backend!.WorkBudgetMilliseconds;
    internal string PipeName => electron?.PipeName ?? vite?.PipeName ?? backend!.PipeName;
    internal string WorkingDirectory => electron?.RunRoot ?? vite?.WorkingDirectory ?? backend!.RepositoryRoot;
    internal string[] Arguments => electron?.Arguments ?? vite?.Arguments ?? [backend!.Entrypoint, "--config", backend.RuntimeConfigPath];
    internal IReadOnlyDictionary<string, string> ChildEnvironment => electron?.Environment ?? vite?.ChildEnvironment(runtimeSession!) ?? backend!.Environment;

    internal static ServiceConfiguration Read(string path, ServiceProfile profile) => profile switch
    {
        ServiceProfile.Backend => new(BackendServiceConfiguration.Read(path)),
        ServiceProfile.Vite => new(ViteServiceConfiguration.Read(path),
            ViteServiceConfiguration.RequireRuntimeSession(Environment.GetEnvironmentVariable(ViteServiceConfiguration.SessionEnvironment))),
        ServiceProfile.Electron => new(ElectronServiceConfiguration.Read(path)),
        ServiceProfile.ElectronBridge => new(ElectronServiceConfiguration.Read(path, profile)),
        _ => throw new AdapterFailure("configurationInvalid"),
    };

    internal void ValidatePaths()
    {
        if (electron is not null) electron.ValidatePaths();
        else if (vite is not null) vite.ValidatePaths(); else backend!.ValidatePaths();
    }

    internal void WriteTerminal(BackendServiceSnapshot state, long cleanupStarted, Action requireDeadline)
        => WriteTerminal(Profile, Generation, electron?.ControlRoot ?? vite?.ControlRoot ?? backend!.ControlRoot,
            electron?.TerminalPath ?? vite?.TerminalPath ?? backend!.TerminalPath, state, cleanupStarted, requireDeadline);

    internal static void WriteTerminal(ServiceProfile profile, string generation, string controlRoot, string terminalPath,
        BackendServiceSnapshot state, long cleanupStarted, Action requireDeadline)
    {
        requireDeadline();
        BackendServiceConfiguration.RequireCanonicalPath(controlRoot, true);
        var pending = terminalPath + ".pending";
        using (var file = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, new { protocol = Protocol(profile), schemaVersion = BackendServiceProtocol.Version,
                generation, kind = "terminal", state, cleanupStartedElapsedMilliseconds = cleanupStarted }, AdapterProtocol.Json);
            file.Flush(true);
        }
        requireDeadline();
        BackendServiceConfiguration.RequireCanonicalPath(controlRoot, true);
        File.Move(pending, terminalPath, false);
        requireDeadline();
    }
}
