using System.Diagnostics;
using Eky.WindowsProcessSupervisor;

namespace Eky.ProcessOwnershipExperiment;

internal static class Program
{
    // Experiment budgets only; ordinary test and installer budgets are unchanged.
    private const int TotalBudgetMilliseconds = 30_000;
    private const int CleanupReserveMilliseconds = 5_000;

    private static int Main(string[] args)
    {
        ExperimentFiles files;
        try { files = ExperimentFiles.Read(args); }
        catch { Console.Error.WriteLine("experimentInputRejected"); return 2; }
        var clock = Stopwatch.StartNew();
        using var job = WindowsJob.Create();
        ExperimentProcess? child = null;
        Task<ExperimentProcess>? creation = null;
        var creationCompleted = false;
        var rootExitObserved = false;
        var descendantsAfterRoot = false;
        var absent = false;
        var reason = "experimentFailed";
        var cleanup = "cleanupUnverified";
        int? childExitCode = null;
        try
        {
            creation = Task.Run(() => ExperimentProcess.Start(files.Node, files.Fixture, files.Directory, job));
            if (!creation.Wait(TimeSpan.FromMilliseconds(RemainingWork())))
                throw new InvalidOperationException("creationDeadline");
            child = creation.GetAwaiter().GetResult();
            creationCompleted = true;
            if (!child.IsOwnedBy(job) || job.GetActiveProcessCount() != 1)
                throw new InvalidOperationException("ownershipUnverified");
            files.Write("owned.json", new { schemaVersion = 1, nonce = files.Nonce, assignedBeforeResume = true });
            child.Resume();
            var command = new byte[1];
            var stop = Console.OpenStandardInput().ReadAsync(command).AsTask();
            reason = "deadlineExceeded";
            while (RemainingWork() > 0)
            {
                var exited = child.HasExited();
                var active = job.GetActiveProcessCount();
                if (exited && !rootExitObserved)
                {
                    rootExitObserved = true;
                    childExitCode = child.ExitCode();
                    descendantsAfterRoot = active > 0;
                    files.Write("root-exited.json", new { schemaVersion = 1, nonce = files.Nonce, descendantsAfterRoot });
                }
                if (exited && active == 0) { reason = "naturalExit"; break; }
                if (stop.IsCompleted)
                {
                    reason = stop.GetAwaiter().GetResult() == 1 && command[0] == (byte)'S' ? "stopRequested" : "controlLost";
                    break;
                }
                Thread.Sleep(Math.Min(10, RemainingWork()));
            }
        }
        catch (SupervisorFailure failure) { reason = failure.ErrorCode; }
        catch { reason = "experimentFailed"; }
        finally
        {
            try
            {
                // A creation still in flight can add a suspended member after a zero count.
                if (!creationCompleted && creation is not null)
                {
                    if (creation.IsCompletedSuccessfully)
                    {
                        child = creation.Result;
                        creationCompleted = true;
                    }
                    else if (creation.IsFaulted || creation.IsCanceled) creationCompleted = true;
                    else _ = creation.ContinueWith(task =>
                    {
                        if (task.IsCompletedSuccessfully) task.Result.Dispose();
                        else _ = task.Exception;
                    }, TaskScheduler.Default);
                }
                job.Terminate();
                while (creationCompleted && clock.ElapsedMilliseconds < TotalBudgetMilliseconds)
                {
                    var rootAbsent = child is null || child.HasExited();
                    if (rootAbsent && job.GetActiveProcessCount() == 0)
                    {
                        absent = true;
                        cleanup = "processTreeAbsent";
                        if (child is not null) childExitCode ??= child.ExitCode();
                        break;
                    }
                    Thread.Sleep(10);
                }
            }
            catch { cleanup = "cleanupFailed"; }
            child?.Dispose();
        }
        var success = absent && childExitCode == 0 && reason is "naturalExit" or "stopRequested";
        try
        {
            files.Write("terminal.json", new
            {
                schemaVersion = 1, nonce = files.Nonce, scenario = files.Case,
                reason, cleanup, processTreeAbsent = absent, creationCompleted,
                rootExitObserved, descendantsAfterRoot, childExitCode,
            });
        }
        catch { Console.Error.WriteLine("terminalWriteFailed"); return 2; }
        return success ? 0 : 1;

        int RemainingWork() => (int)Math.Max(0, TotalBudgetMilliseconds - CleanupReserveMilliseconds - clock.ElapsedMilliseconds);
    }
}
