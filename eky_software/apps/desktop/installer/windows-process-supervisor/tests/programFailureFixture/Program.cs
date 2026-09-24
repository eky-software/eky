using Eky.WindowsProcessSupervisor;
using System.Text;
using System.Text.Json;

if (!SupervisorCallerAdmission.TryAccept(ref args)) return 64;

if (
    args.Length != 4 ||
    !string.Equals(args[0], "--mode", StringComparison.Ordinal) ||
    !string.Equals(args[2], "--request", StringComparison.Ordinal)
)
{
    return 64;
}

var mode = args[1];
if (mode == "deadlineClockContracts") return DeadlineReadinessContract.RunClockContracts(args[3]);
if (DeadlineReadinessContract.Modes.Contains(mode))
    return DeadlineReadinessContract.Run(mode, args[3]);
if (mode == "shortPathLookup") return ShortPathContract.Run(args[3]);
if (mode == "preparationBudget")
{
    using var input = JsonDocument.Parse(File.ReadAllText(args[3]));
    var results = input.RootElement.EnumerateArray().Select(value =>
    {
        var deadline = AcceptanceCommandProgram.CalculatePreparationTimeout(
            value.GetProperty("phaseTimeout").GetInt32(), value.GetProperty("cleanup").GetInt32(),
            value.GetProperty("normalWorkCap").GetInt32());
        return new { deadline, remaining = SupervisorProgram.RemainingPreparationMilliseconds(
            deadline, value.GetProperty("elapsed").GetInt64()) };
    }).ToArray();
    File.WriteAllText(Path.Combine(Path.GetDirectoryName(args[3])!, "command-budget-result.json"), JsonSerializer.Serialize(results));
    return 0;
}
if (mode == "commandFixtureBudget")
{
    using var input = JsonDocument.Parse(File.ReadAllText(args[3]));
    var results = input.RootElement.EnumerateArray().Select(value =>
    {
        var budget = CommandFixtureBudget.Resolve(value.GetProperty("testCase").GetString()!,
            value.GetProperty("kind").GetString()!, value.GetProperty("phase").GetString()!);
        return new { timeout = budget.Timeout, cleanup = budget.Cleanup };
    }).ToArray();
    File.WriteAllText(Path.Combine(Path.GetDirectoryName(args[3])!, "command-budget-result.json"), JsonSerializer.Serialize(results));
    return 0;
}
if (mode == "commandBudget")
{
    using var input = JsonDocument.Parse(File.ReadAllText(args[3]));
    var results = input.RootElement.EnumerateArray().Select(value =>
        AcceptanceCommandProgram.CalculatePhaseTimeout(
            value.GetProperty("commandReservation").GetInt32(), value.GetProperty("elapsed").GetInt64(),
            value.GetProperty("exitReserve").GetInt32(), value.GetProperty("phaseTimeout").GetInt32(),
            value.GetProperty("publicationTimeout").GetInt32(), value.GetProperty("publishing").GetBoolean())).ToArray();
    File.WriteAllText(Path.Combine(Path.GetDirectoryName(args[3])!, "command-budget-result.json"), JsonSerializer.Serialize(results));
    return 0;
}
if (mode == "legacyCommandEntry")
{
    using var input = JsonDocument.Parse(File.ReadAllText(args[3]));
    Environment.SetEnvironmentVariable("npm_node_execpath", input.RootElement.GetProperty("node").GetString());
    var blocked = input.RootElement.TryGetProperty("evidenceRequestPath", out var evidenceRequest);
    if (blocked) Console.SetOut(new BlockedEvidenceWriter(Console.Out,
        SupervisorRequestReader.Read(["--request", evidenceRequest.GetString()!])));
    var arguments = input.RootElement.GetProperty("arguments").EnumerateArray().Select(value => value.GetString()!).ToArray();
    var testCase = input.RootElement.GetProperty("testCase").GetString()!;
    var kind = arguments[0] == "--clean-command" ? "clean" : "other";
    using var preparationRelease = new ManualResetEvent(false);
    using var preparationFinished = new ManualResetEvent(false);
    Action<string, bool>? prepare = testCase is "requestPreparationDelayed" or "requestPreparationHold" or "requestPreparationLate"
        ? (phase, completed) =>
        {
            if (phase != "inspectSourceBefore") return;
            var marker = Path.Combine(Path.GetDirectoryName(args[3])!, "preparation-observation.json");
            File.WriteAllText(marker, JsonSerializer.Serialize(new { schemaVersion = 1, entered = true, completed }));
            if (completed) { preparationFinished.Set(); return; }
            // One deliberate delay crosses the old admission cap; it is not a success wait.
            using var releaseTimer = new Timer(_ => preparationRelease.Set(), null,
                testCase == "requestPreparationDelayed" ? 6_000 : Timeout.Infinite, Timeout.Infinite);
            preparationRelease.WaitOne();
        } : null;
    var exitCode = AcceptanceCommandProgram.Run(arguments, input.RootElement.GetProperty("worker").GetString(),
        input.RootElement.TryGetProperty("useCanonicalBudgets", out var canonical) && canonical.GetBoolean()
            ? null : phase => CommandFixtureBudget.Resolve(testCase, kind, phase), prepare);
    if (testCase == "requestPreparationLate")
    {
        preparationRelease.Set();
        if (!preparationFinished.WaitOne(TimeSpan.FromSeconds(5))) return 65;
    }
    return exitCode;
}
if (mode.StartsWith("phaseContinuation", StringComparison.Ordinal))
{
    return SupervisorPhaseContinuationContract.Run(mode, args[3]);
}
if (mode == "callerAdmission")
{
    File.WriteAllText(args[3], "{}");
    return 0;
}
if (mode == "nativeMsiContract")
{
    return await NativeMsiAdapterContract.Run(args[3]);
}
if (mode == "nativeProductInspectionContract")
{
    return NativeProductInspectionContract.Run(args[3]);
}
if (mode == "blockedInvalidRequestEvidence")
{
    // Read only the valid fixture binding before presenting malformed input to the program.
    var request = SupervisorRequestReader.Read(args[2..]);
    var malformedPath = Path.Combine(request.WorkingDirectory, "malformed-request.json");
    File.WriteAllText(malformedPath, "{}");
    using var writeEntered = new ManualResetEventSlim(false);
    Console.SetOut(new BlockedEvidenceWriter(Console.Out, request, writeEntered));
    var exitCode = SupervisorProgram.Run(["--request", malformedPath]);
    // Observe the output attempt even when best-effort delivery races command return.
    return writeEntered.Wait(TimeSpan.FromSeconds(5)) ? exitCode : 65;
}
if (mode == "blockedEvidence")
{
    var request = SupervisorRequestReader.Read(args[2..]);
    Console.SetOut(new BlockedEvidenceWriter(Console.Out, request));
    return SupervisorProgram.Run(args[2..]);
}
if (mode == "nativePendingAtCommandExit")
{
    return LateProcessCreationContract.RunPendingCommand(args[2..]);
}
if (LateProcessCreationContract.Modes.Contains(mode))
{
    return SupervisorProgram.Run(args[2..], (request, stopwatch, evidence) =>
        LateProcessCreationContract.Run(mode, request, stopwatch, evidence));
}
if (mode == "measureCreation")
{
    return SupervisorProgram.Run(args[2..], ProcessCreationMeasurement.Run);
}
if (ProcessBoundaryContract.Modes.Contains(mode))
{
    return SupervisorProgram.Run(args[2..], (request, stopwatch, evidence) =>
        ProcessBoundaryContract.Run(mode, request, stopwatch, evidence));
}
if (mode is not ("unexpectedFailure" or "resultWriteFailure"))
{
    return 64;
}

return SupervisorProgram.Run(
    args[2..],
    (request, _, _) =>
    {
        if (string.Equals(mode, "resultWriteFailure", StringComparison.Ordinal))
        {
            Directory.CreateDirectory(request.ResultPath);
        }
        throw new InvalidOperationException("contractFixtureFailure");
    }
);

internal sealed class BlockedEvidenceWriter(
    TextWriter output, SupervisorRequest request, ManualResetEventSlim? invalidWriteEntered = null
) : TextWriter
{
    public override Encoding Encoding => Encoding.UTF8;

    public override void WriteLine(string? value)
    {
        using var document = JsonDocument.Parse(value!);
        var root = document.RootElement;
        var expectedPhase = invalidWriteEntered is null ? "waitStarted" : "requestValidated";
        var expectedStatus = invalidWriteEntered is null ? "started" : "failed";
        if (root.GetProperty("phase").GetString() == expectedPhase &&
            root.GetProperty("status").GetString() == expectedStatus)
        {
            var runRoot = Path.Combine(request.WorkingDirectory, request.RunNonce);
            Directory.CreateDirectory(runRoot);
            var marker = Path.Combine(runRoot, "output.ready.json");
            File.WriteAllText(marker + ".next", JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                runNonce = request.RunNonce,
                role = "output",
                processId = Environment.ProcessId,
                writerBlocked = true,
                errorCode = root.TryGetProperty("errorCode", out var errorCode)
                    ? errorCode.GetString() : null,
            }));
            File.Move(marker + ".next", marker);
            invalidWriteEntered?.Set();
            // Model a consumer that never drains its pipe; only this owned fixture blocks.
            using var neverDrained = new ManualResetEvent(false);
            neverDrained.WaitOne();
        }
        output.WriteLine(value);
    }
}
