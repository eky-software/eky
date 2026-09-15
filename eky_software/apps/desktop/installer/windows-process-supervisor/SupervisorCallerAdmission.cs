namespace Eky.WindowsProcessSupervisor;

public static class SupervisorCallerAdmission
{
    // Only the test caller opts in. EOF/cancellation can never authorize a Job.
    public static bool TryAccept(ref string[] arguments)
    {
        if (arguments.Length == 0 || arguments[^1] != "--caller-admission") return true;
        arguments = arguments[..^1];
        try
        {
            var input = Console.OpenStandardInput();
            var permit = new byte[1];
            return input.ReadAsync(permit).AsTask().WaitAsync(TimeSpan.FromSeconds(5))
                .GetAwaiter().GetResult() == 1 && permit[0] == 1;
        }
        catch { return false; }
    }
}
