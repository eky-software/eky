using Eky.WindowsProcessSupervisor;
using System.Text;
using System.Text.Json;

if (
    args.Length != 4 ||
    !string.Equals(args[0], "--mode", StringComparison.Ordinal) ||
    !string.Equals(args[2], "--request", StringComparison.Ordinal)
)
{
    return 64;
}

var mode = args[1];
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

internal sealed class BlockedEvidenceWriter(TextWriter output, SupervisorRequest request) : TextWriter
{
    public override Encoding Encoding => Encoding.UTF8;

    public override void WriteLine(string? value)
    {
        using var document = JsonDocument.Parse(value!);
        var root = document.RootElement;
        if (root.GetProperty("phase").GetString() == "waitStarted" &&
            root.GetProperty("status").GetString() == "started")
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
            }));
            File.Move(marker + ".next", marker);
            // Model a consumer that never drains its pipe; only this owned fixture blocks.
            using var neverDrained = new ManualResetEvent(false);
            neverDrained.WaitOne();
        }
        output.WriteLine(value);
    }
}
