using System.Diagnostics;

namespace Eky.WindowsProcessSupervisor;

internal interface ISupervisorDeadline
{
    long ElapsedMilliseconds { get; }
    bool WaitForTask(Task task, long deadlineMilliseconds);
    void OnCleanupStarting();
}

internal sealed class StopwatchSupervisorDeadline(
    Stopwatch stopwatch, Action<Task, int>? waitForTask = null
) : ISupervisorDeadline
{
    public long ElapsedMilliseconds => stopwatch.ElapsedMilliseconds;

    public bool WaitForTask(Task task, long deadlineMilliseconds)
    {
        while (!task.IsCompleted)
        {
            var remaining = deadlineMilliseconds - stopwatch.ElapsedMilliseconds;
            if (remaining <= 0) break;
            // A relative wait returning does not prove the absolute deadline has elapsed.
            var timeout = (int)Math.Min(int.MaxValue, remaining);
            if (waitForTask is null) Task.WaitAny([task], timeout);
            else waitForTask(task, timeout);
        }
        return task.IsCompleted;
    }

    public void OnCleanupStarting() { }
}
