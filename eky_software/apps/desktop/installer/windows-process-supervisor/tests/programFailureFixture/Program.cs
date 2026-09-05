using Eky.WindowsProcessSupervisor;

if (
    args.Length != 4 ||
    !string.Equals(args[0], "--mode", StringComparison.Ordinal) ||
    !string.Equals(args[2], "--request", StringComparison.Ordinal)
)
{
    return 64;
}

var mode = args[1];
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
