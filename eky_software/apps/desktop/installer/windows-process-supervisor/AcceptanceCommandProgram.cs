using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace Eky.WindowsProcessSupervisor;

// Fixed acceptance phases, not a worker-supplied command graph. Node retains
// artifact, business and exact-product decisions; this owner only runs phases.
internal static class AcceptanceCommandProgram
{
    internal static int Run(string[] arguments)
    {
        try { return Run(arguments, null); }
        catch { SafeEvidenceWriter.WriteInvalidRequest("unexpectedFailure"); return 1; }
    }

    internal static int Run(string[] arguments, string? contractWorker, int? contractTimeout = null)
    {
        var clock = Stopwatch.StartNew();
        var kind = arguments.FirstOrDefault() switch
        {
            "--legacy-command" => "legacy",
            "--workspace-success-command" => "workspaceSuccess",
            "--workspace-fault-command" => "workspaceFault",
            _ => null,
        };
        if (kind is null || arguments.Length != (kind == "workspaceFault" ? 11 : 9)) return 64;
        var input = arguments[1..];
        if (input[0] != "--artifact-descriptor" || input[2] != "--expected-descriptor-sha256" ||
            input[4] != "--expected-build-revision" || input[^2] != "--result-path" ||
            (kind == "workspaceFault" && input[6] != "--fault-scenario") ||
            !IsHex(input[3], 64) || !IsHex(input[5], 40)) return 64;
        var scenario = kind switch
        {
            "legacy" => "historicalLegacyUpgrade",
            "workspaceSuccess" => "packagedWorkspaceSuccess",
            _ => "packagedWorkspaceFaultRollback",
        };
        var context = new CommandContext(
            Path.Combine(Path.GetTempPath(), "eky-acceptance-command-" + Guid.NewGuid().ToString("N")),
            input, kind, scenario, NewNonce(), contractWorker);
        using var budgetStream = typeof(AcceptanceCommandProgram).Assembly.GetManifestResourceStream("supervisorCommandBudgets.json")!;
        using var budgets = JsonDocument.Parse(budgetStream);
        var exitReserve = budgets.RootElement.GetProperty("exitReserveMilliseconds").GetInt32();
        var plan = budgets.RootElement.GetProperty(kind == "legacy" ? "legacyCommand" : "workspaceCommand");
        var deadline = plan.GetProperty("reservationMilliseconds").GetInt32();
        var phases = plan.GetProperty("phases").EnumerateArray().Select(value =>
            (Name: value[0].GetString()!, Timeout: value[1].GetInt32(), Cleanup: value[2].GetInt32())).ToArray();
        var publication = phases[^1];
        var failed = false;
        SafeEvidenceWriter? evidence = null;
        try
        {
            try { evidence = new SafeEvidenceWriter(scenario, clock); } catch { /* Optional diagnostics. */ }
            foreach (var phase in phases)
            {
                var remaining = deadline - clock.ElapsedMilliseconds - exitReserve -
                    (phase.Name == "publish" ? 0 : (contractTimeout ?? publication.Timeout) + exitReserve);
                var timeout = (int)Math.Min(contractTimeout ?? phase.Timeout, remaining);
                var cleanup = contractTimeout.HasValue ? 1_000 : phase.Cleanup;
                if (timeout <= cleanup) return PublishFailure(context,
                    (int)Math.Min(publication.Timeout, deadline - clock.ElapsedMilliseconds - exitReserve), publication.Cleanup, evidence);
                var nonce = phase.Name == "scenario" ? context.ScenarioRunNonce : NewNonce();
                evidence?.Write(phase.Name, "started");
                var completion = RunPhase(context, phase.Name, nonce, timeout, cleanup, evidence);
                context.History.Add(new { phase = phase.Name, runNonce = nonce, exitCode = completion.ExitCode,
                    resultWritten = completion.ResultWritten, processBoundaryVerified = completion.ProcessBoundaryVerified,
                    requestErrorCode = completion.RequestErrorCode });
                evidence?.Write(phase.Name, completion.ExitCode == 0 ? "completed" : "failed");
                // Pending host I/O or unverified process cleanup forbids every
                // continuation. Retain evidence and exit; no emergency fallback.
                if (!completion.ProcessBoundaryVerified) return 1;
                failed |= completion.ExitCode != 0;
                if (phase.Name == "publish") return failed ? 1 : 0;
                if (completion.ExitCode != 0 && phase.Name != "scenario")
                    return PublishFailure(context,
                        (int)Math.Min(contractTimeout ?? publication.Timeout, deadline - clock.ElapsedMilliseconds - exitReserve),
                        contractTimeout.HasValue ? 1_000 : publication.Cleanup, evidence);
            }
            return failed ? 1 : 0;
        }
        finally { evidence?.CompleteWithinRequestBudget(0); }
    }

    private static int PublishFailure(CommandContext context, int timeout, int cleanup, SafeEvidenceWriter? evidence)
    {
        if (timeout > cleanup) _ = RunPhase(context, "publishFailure", NewNonce(), timeout, cleanup, evidence);
        return 1;
    }

    private static SupervisorPhaseCompletion RunPhase(CommandContext context, string phase, string nonce, int timeout, int cleanup,
        SafeEvidenceWriter? evidence) =>
        SupervisorProgram.RunPhase(() =>
        {
            var phaseRoot = Path.Combine(context.Root, phase);
            Directory.CreateDirectory(phaseRoot);
            var inputPath = Path.Combine(phaseRoot, "phase-input.json");
            WriteExclusive(inputPath, new { schemaVersion = 1, phase, commandKind = context.Kind,
                scenarioRunNonce = context.ScenarioRunNonce, commandArguments = context.Input, history = context.History });
            var requestPath = Path.Combine(phaseRoot, "request.json");
            var worker = context.ContractWorker ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
                "../../../../windows-acceptance-harness", context.Kind == "legacy" ? "legacyCommandPhase.mjs" : "workspaceCommandPhase.mjs"));
            WriteExclusive(requestPath, new { schemaVersion = 1, runNonce = nonce,
                scenario = phase == "scenario" ? context.Scenario : "acceptanceCommandPhase",
                artifactDescriptorSha256 = context.Input[3], command = ResolveNodeExecutable(),
                arguments = new[] { worker, "--phase-request", inputPath }, workingDirectory = phaseRoot,
                timeoutMilliseconds = timeout, cleanupReserveMilliseconds = cleanup });
            return SupervisorRequestReader.Read(["--request", requestPath]);
        }, commandEvidence: evidence);

    private sealed record CommandContext(string Root, string[] Input, string Kind, string Scenario,
        string ScenarioRunNonce, string? ContractWorker)
    {
        internal List<object> History { get; } = [];
    }

    private static string NewNonce() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
    private static bool IsHex(string value, int length) => value.Length == length &&
        value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static string ResolveNodeExecutable()
    {
        var supplied = Environment.GetEnvironmentVariable("npm_node_execpath");
        if (!string.IsNullOrEmpty(supplied))
        {
            if (!Path.IsPathFullyQualified(supplied)) throw new SupervisorFailure("requestCommandInvalid");
            return supplied;
        }
        // pnpm exec does not populate npm_node_execpath. Resolve only the fixed
        // Node tool from absolute PATH entries, never an input command or shell.
        foreach (var entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            var directory = entry.Trim('"');
            if (!Path.IsPathFullyQualified(directory)) continue;
            var candidate = Path.Combine(directory, "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new SupervisorFailure("requestCommandInvalid");
    }

    private static void WriteExclusive(string path, object value)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(stream, value);
        stream.Flush(true);
    }
}
