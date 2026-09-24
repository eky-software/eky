using System.Diagnostics;

namespace Eky.WindowsProcessSupervisor;

internal interface ISupervisorDeadline
{
    long ElapsedMilliseconds { get; }
    bool WaitForTask(Task task, long deadlineMilliseconds);
    void OnCleanupStarting();
}

internal sealed class StopwatchSupervisorDeadline(Stopwatch stopwatch) : ISupervisorDeadline
{
    public long ElapsedMilliseconds => stopwatch.ElapsedMilliseconds;

    public bool WaitForTask(Task task, long deadlineMilliseconds)
    {
        var remaining = deadlineMilliseconds - stopwatch.ElapsedMilliseconds;
        if (!task.IsCompleted && remaining > 0)
            Task.WaitAny([task], (int)Math.Min(int.MaxValue, remaining));
        return task.IsCompleted;
    }

    public void OnCleanupStarting() { }
}
