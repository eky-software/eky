using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Eky.ProcessOwnershipAdapter;

internal sealed partial class BackendServiceOwner
{
    // Separate real-process proof. The ordinary contract self-tests remain process-free.
    internal static async Task<int> RunResumeFailureSelfTestAsync(string nodeExecutable)
    {
        var checks = 0;
        var stage = "guard";
        var passed = false;
        BackendServiceOwner? owner = null;
        void Check(bool condition)
        {
            checks++;
            if (!condition) throw new AdapterFailure("resumeFailureSelfTestFailed");
        }

        try
        {
            BackendServiceConfiguration.RequireGuard();
            BackendServiceConfiguration.RequireCanonicalPath(nodeExecutable, false);
            Check(string.Equals(Path.GetFileName(nodeExecutable), "node.exe", StringComparison.OrdinalIgnoreCase));
            stage = "preparation";
            var elapsed = Stopwatch.StartNew();
            var clock = new BackendServiceClock(AdapterProtocol.WorkMilliseconds, () => elapsed.ElapsedMilliseconds);
            var fixture = ResumeFailureSelfTestFixture.Create(nodeExecutable);
            AdapterProcess? retainedChild = null;
            SafeWaitHandle? retainedThread = null;
            BackendServiceIdentity? identity = null;
            var resumeCalls = 0;
            owner = new BackendServiceOwner(fixture.Config, clock, thread =>
            {
                stage = "resume";
                resumeCalls++;
                retainedChild = owner!.child;
                retainedThread = thread;
                identity = retainedChild?.ReadBackendIdentity();
                Check(resumeCalls == 1 && retainedChild is not null && !retainedChild.HasExited());
                Check(!thread.IsClosed && !thread.IsInvalid && owner.job!.GetActiveProcessCount() == 1);
                Check(owner.state is { Created: true, Started: false, AssignedBeforeResume: true,
                    CreationCompleted: false, FirstFailure: null } && owner.state.Identity == identity);
                Check(clock.CleanupStarted is null && clock.RemainingWork > 0);
                // Exercise VerifyAndResume's real failure branch, not a synthetic state.Fail call.
                return uint.MaxValue;
            });

            using var bound = new CancellationTokenSource(TimeSpan.FromMilliseconds(
                clock.RemainingWork + BackendServiceProtocol.CleanupMilliseconds));
            using var client = LocalControlPipe.Client(fixture.Config.PipeName, PipeDirection.InOut);
            var running = owner.RunAsync();
            var ownerExit = -1;
            try
            {
                stage = "launch";
                await client.ConnectAsync(bound.Token);
                clock.RequireWork();
                await LaunchAsync(1);
                var first = await ReadTerminalAsync(1);
                stage = "terminal";
                var observedChild = retainedChild ?? throw new AdapterFailure("resumeFailureSelfTestFailed");
                Check(first.State is { Created: true, Started: false, CreationCompleted: true, LaunchClosed: true,
                    AssignedBeforeResume: true, Workload: "exited", ExitCode: 1, ActiveProcesses: 0, StdioSettled: true,
                    FirstFailure: "processResumeFailed", Cleanup: "processTreeAbsent", CleanupFailure: null });
                Check(identity is not null && first.State.Identity == identity && resumeCalls == 1);
                Check(ReferenceEquals(owner.child, observedChild) && observedChild.HasExited() &&
                    observedChild.ReadBackendIdentity() == identity && observedChild.ExitCode() == first.State.ExitCode);
                Check(owner.job!.GetActiveProcessCount() == 0 && owner.state.CanProveAbsent);
                Check(owner.outputRelay is { IsSettled: true, Failure: null } &&
                    owner.errorRelay is { IsSettled: true, Failure: null });
                Check(owner.io!.Input.IsClosed && owner.io.Output.IsClosed && owner.io.Error.IsClosed);
                Check(retainedThread is { IsClosed: false } && !File.Exists(fixture.UnexpectedRunPath));
                Check(first.CleanupStartedElapsedMilliseconds == clock.CleanupStarted &&
                    first.RemainingCleanupMilliseconds > 0 && first.ElapsedMilliseconds + first.RemainingCleanupMilliseconds ==
                    first.CleanupStartedElapsedMilliseconds + BackendServiceProtocol.CleanupMilliseconds);

                // Terminal delivery and repeated requests must fit the owner's existing cleanup bound.
                bound.CancelAfter(TimeSpan.FromMilliseconds(clock.RemainingCleanup!.Value));
                await ControlFrame.WriteAsync(client, new { protocol = BackendServiceProtocol.Name, schemaVersion = 1,
                    generation = fixture.Config.Generation, sequence = 2, kind = "stop" }, bound.Token);
                var repeated = await ReadTerminalAsync(2);
                await LaunchAsync(3);
                var rejectedRelaunch = await ReadTerminalAsync(3);
                Check(first.State == repeated.State && first.State == rejectedRelaunch.State && resumeCalls == 1);
                Check(first.CleanupStartedElapsedMilliseconds == repeated.CleanupStartedElapsedMilliseconds &&
                    first.CleanupStartedElapsedMilliseconds == rejectedRelaunch.CleanupStartedElapsedMilliseconds &&
                    first.RemainingCleanupMilliseconds >= repeated.RemainingCleanupMilliseconds &&
                    repeated.RemainingCleanupMilliseconds >= rejectedRelaunch.RemainingCleanupMilliseconds);
                Check(ReferenceEquals(owner.child, observedChild) && observedChild.HasExited() && owner.job!.GetActiveProcessCount() == 0);
                using var file = new FileStream(fixture.TerminalPath, FileMode.Open, FileAccess.Read, FileShare.Read);
                Check(file.Length is > 0 and <= AdapterProtocol.FrameBytes);
                using var terminal = JsonDocument.Parse(file);
                var value = terminal.RootElement;
                AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "kind", "state", "cleanupStartedElapsedMilliseconds");
                BackendServiceProtocol.Identity(value, fixture.Config.Generation);
                Check(value.GetProperty("kind").GetString() == "terminal" &&
                    value.GetProperty("state").Deserialize<BackendServiceSnapshot>(AdapterProtocol.Json) == first.State &&
                    value.GetProperty("cleanupStartedElapsedMilliseconds").GetInt64() == first.CleanupStartedElapsedMilliseconds);
                clock.RequireCleanup();
            }
            finally
            {
                // EOF lets the normal owner loop finish; assertions never substitute their own cleanup.
                client.Dispose();
                ownerExit = await running;
            }
            stage = "ownerClosed";
            clock.RequireCleanup();
            Check(ownerExit == 0 && resumeCalls == 1 && owner.terminal?.FirstFailure == "processResumeFailed");
            Check(clock.CleanupStarted is { } started && elapsed.ElapsedMilliseconds < started + BackendServiceProtocol.CleanupMilliseconds);
            owner.Dispose();
            owner = null;
            Check(retainedThread is { IsClosed: true } && !File.Exists(fixture.UnexpectedRunPath));
            fixture.RemoveVerifiedRoot();
            Check(!Directory.Exists(fixture.Root));
            stage = "complete";
            passed = true;

            Task LaunchAsync(long sequence) => ControlFrame.WriteAsync(client, new
            {
                protocol = BackendServiceProtocol.Name, schemaVersion = 1, generation = fixture.Config.Generation,
                sequence, kind = "launch", launchNonce = fixture.Config.LaunchNonce,
                workDeadlineElapsedMilliseconds = AdapterProtocol.WorkMilliseconds,
            }, bound.Token);

            async Task<BackendServiceReply> ReadTerminalAsync(long sequence)
            {
                using var frame = await ControlFrame.ReadAsync(client, bound.Token)
                    ?? throw new AdapterFailure("resumeFailureSelfTestFailed");
                AdapterProtocol.ExactKeys(frame.RootElement, "protocol", "schemaVersion", "generation", "sequence", "replyTo",
                    "kind", "state", "rssBytes", "elapsedMilliseconds", "cleanupStartedElapsedMilliseconds", "remainingCleanupMilliseconds");
                var reply = frame.RootElement.Deserialize<BackendServiceReply>(AdapterProtocol.Json)
                    ?? throw new AdapterFailure("resumeFailureSelfTestFailed");
                Check(reply.Protocol == BackendServiceProtocol.Name && reply.SchemaVersion == BackendServiceProtocol.Version &&
                    reply.Generation == fixture.Config.Generation && reply.Sequence == sequence && reply.ReplyTo == sequence && reply.Kind == "terminal");
                clock.RequireCleanup();
                return reply;
            }
        }
        catch
        {
            // Retain the fixture on any failed assertion; no paths, PID, native text or stack are published.
        }
        finally { owner?.Dispose(); }
        Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, kind = "resumeFailureSelfTest", passed, stage, checks }));
        return passed ? 0 : 1;
    }
}
