using System.Diagnostics;
using Eky.WindowsProcessSupervisor;

internal sealed class ControlledSupervisorDeadline : ISupervisorDeadline
{
    internal const int SetupTimeoutMilliseconds = 10_000;
    internal const int WaitSliceMilliseconds = 100;
    internal const string SetupDeadlineExceeded = "setupDeadlineExceeded";
    internal const string CleanupBeforeDeadline = "cleanupBeforeDeadline";

    private readonly object gate = new();
    private readonly Stopwatch stopwatch = Stopwatch.StartNew();
    private readonly int workDeadlineMilliseconds;
    private long? cleanupStartedAtMilliseconds;
    private string? setupFailureCode;

    internal ControlledSupervisorDeadline(int workDeadlineMilliseconds)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(workDeadlineMilliseconds);
        this.workDeadlineMilliseconds = workDeadlineMilliseconds;
    }

    public long ElapsedMilliseconds
    {
        get
        {
            lock (gate)
            {
                var now = stopwatch.ElapsedMilliseconds;
                CheckSetupGuard(now);
                return GetElapsedMilliseconds(now);
            }
        }
    }

    internal string? SetupFailureCode
    {
        get
        {
            lock (gate)
            {
                CheckSetupGuard(stopwatch.ElapsedMilliseconds);
                return setupFailureCode;
            }
        }
    }

    public bool WaitForTask(Task task, long deadlineMilliseconds)
    {
        while (true)
        {
            int waitMilliseconds;
            lock (gate)
            {
                var now = stopwatch.ElapsedMilliseconds;
                CheckSetupGuard(now);
                var remaining = deadlineMilliseconds - GetElapsedMilliseconds(now);
                if (task.IsCompleted || remaining <= 0) return task.IsCompleted;

                waitMilliseconds = (int)Math.Min(WaitSliceMilliseconds, remaining);
                if (cleanupStartedAtMilliseconds is null)
                    waitMilliseconds = (int)Math.Min(waitMilliseconds, SetupTimeoutMilliseconds - now);
            }
            // A real wait slice only rechecks state; it cannot expire the frozen work clock.
            Task.WaitAny([task], waitMilliseconds);
        }
    }

    internal bool TryTriggerDeadline()
    {
        lock (gate)
        {
            var now = stopwatch.ElapsedMilliseconds;
            CheckSetupGuard(now);
            if (cleanupStartedAtMilliseconds is not null) return false;
            cleanupStartedAtMilliseconds = now;
            return true;
        }
    }

    internal void RejectSetup(string failureCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(failureCode);
        lock (gate)
        {
            setupFailureCode ??= failureCode;
            var now = stopwatch.ElapsedMilliseconds;
            CheckSetupGuard(now);
            cleanupStartedAtMilliseconds ??= now;
        }
    }

    public void OnCleanupStarting()
    {
        lock (gate)
        {
            var now = stopwatch.ElapsedMilliseconds;
            CheckSetupGuard(now);
            if (cleanupStartedAtMilliseconds is not null) return;
            setupFailureCode ??= CleanupBeforeDeadline;
            cleanupStartedAtMilliseconds = now;
        }
    }

    private void CheckSetupGuard(long now)
    {
        if (cleanupStartedAtMilliseconds is not null || now < SetupTimeoutMilliseconds) return;
        setupFailureCode ??= SetupDeadlineExceeded;
        // Anchor expiry to the total setup guard, even when the next observation is late.
        cleanupStartedAtMilliseconds = SetupTimeoutMilliseconds;
    }

    private long GetElapsedMilliseconds(long now) =>
        cleanupStartedAtMilliseconds is long startedAt
            ? workDeadlineMilliseconds + now - startedAt
            : 0;
}
