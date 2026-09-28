using System.Text;
using System.Text.Json;
using Eky.WindowsProcessSupervisor;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class AdapterSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static int checks;
    private static void Check(bool condition) { checks++; if (!condition) throw new AdapterFailure("selfTestFailed"); }
    private static void Reject(Action action)
    {
        try { action(); } catch (AdapterFailure) { checks++; return; }
        throw new AdapterFailure("selfTestFailed");
    }
    private static async Task RejectAsync(Func<Task> action)
    {
        try { await action(); } catch (AdapterFailure) { checks++; return; }
        throw new AdapterFailure("selfTestFailed");
    }

    private static JsonDocument Json(object value) => JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(value));
    private static object Caller(string kind, object sequence) => new { schemaVersion = 1, generation = Generation, sequence, kind };

    internal static async Task<int> RunAsync()
    {
        try
        {
            TestCallerContract();
            TestLaunchContract();
            TestStateMachine();
            TestHandleAndPathContract();
            await TestFramesAsync();
            await TestRelayAsync();
            await TestRelayFinalizationAsync();
            await TestStrictWriteAsync();
            TestBridgeFailureEvidence();
            await TestBridgeDrainCompletionAsync();
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, kind = "selfTest", passed = true, checks }));
            return 0;
        }
        catch
        {
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, kind = "selfTest", passed = false, checks }));
            return 1;
        }
    }

    private static void TestCallerContract()
    {
        foreach (var kind in new[] { "status", "stop", "breakBridge" })
        {
            using var frame = Json(Caller(kind, 1));
            var request = AdapterProtocol.Caller(frame.RootElement, Generation, 0);
            Check(request.Sequence == 1 && request.Kind == kind);
            Reject(() => AdapterProtocol.Caller(frame.RootElement, Generation, 1));
            Reject(() => AdapterProtocol.Caller(frame.RootElement, Nonce, 0));
        }
        foreach (var sequence in new object[] { 0, -1, 1.5, "1", 9007199254740992L })
        {
            using var invalid = Json(Caller("status", sequence));
            Reject(() => AdapterProtocol.Caller(invalid.RootElement, Generation, 0));
        }
        using var unknown = Json(Caller("restart", 1));
        Reject(() => AdapterProtocol.Caller(unknown.RootElement, Generation, 0));
        using var duplicate = JsonDocument.Parse($"{{\"schemaVersion\":1,\"generation\":\"{Generation}\",\"sequence\":1,\"sequence\":2,\"kind\":\"status\"}}");
        Reject(() => AdapterProtocol.Caller(duplicate.RootElement, Generation, 0));
        using var extra = Json(new { schemaVersion = 1, generation = Generation, sequence = 1, kind = "status", privateData = "rejected" });
        Reject(() => AdapterProtocol.Caller(extra.RootElement, Generation, 0));
        using var wrongType = Json(new { schemaVersion = "1", generation = Generation, sequence = 1, kind = "status" });
        Reject(() => AdapterProtocol.Caller(wrongType.RootElement, Generation, 0));
    }

    private static void TestLaunchContract()
    {
        var env = new Dictionary<string, string> { ["EKY_E2E"] = "1", ["TEMP"] = @"C:\synthetic\tmp" };
        var config = new AdapterConfiguration(Generation, Nonce, @"C:\synthetic\electron.exe", @"C:\synthetic\case", @"C:\synthetic", env);
        object Frame(string[] args, string nonce, string cwd, object environment) => new
        { schemaVersion = 1, generation = Generation, nonce, kind = "launch", args, cwd, environment };
        var args = new[] { "--inspect=0", "--remote-debugging-port=0", @"C:\synthetic\case\app.cjs", "synthetic arg with spaces" };
        using var valid = Json(Frame(args, Nonce, config.Cwd, env));
        Check(AdapterProtocol.Launch(valid.RootElement, config).SequenceEqual(args));
        foreach (var value in new[]
        {
            Frame(args, Generation, config.Cwd, env), Frame(args, Nonce, @"C:\different", env),
            Frame(args, Nonce, config.Cwd, new { EKY_E2E = "0", TEMP = @"C:\synthetic\tmp" }),
            Frame(args, Nonce, config.Cwd, new { EKY_E2E = "1" }),
            Frame(["bad\0arg"], Nonce, config.Cwd, env), Frame([], Nonce, config.Cwd, env),
            Frame(Enumerable.Repeat("x", 65).ToArray(), Nonce, config.Cwd, env),
        })
        {
            using var frame = Json(value);
            Reject(() => AdapterProtocol.Launch(frame.RootElement, config));
        }
        foreach (var invalid in new[] { "{\"PATH\":\"x\",\"Path\":\"x\"}", "{\"NODE_OPTIONS\":\"x\"}",
            "{\"ELECTRON_RUN_AS_NODE\":\"1\"}", "{\"bad=key\":\"x\"}", "{\"TEMP\":1}" })
        {
            using var frame = JsonDocument.Parse(invalid);
            Reject(() => AdapterConfiguration.EnvironmentMap(frame.RootElement));
        }
        Check(WindowsCommandLine.Build(@"C:\test folder\a.exe", ["", "with spaces", "quote\"tail", "tail \\"])
            == "\"C:\\test folder\\a.exe\" \"\" \"with spaces\" \"quote\\\"tail\" \"tail \\\\\"");
    }

    private static AdapterState Started()
    {
        var state = new AdapterState();
        state.Created(); state.Assigned(); state.SettleCreation();
        return state;
    }

    private static void TestStateMachine()
    {
        var state = Started();
        Reject(state.RequireLaunch);
        state.Observe(false, null, 2);
        Check(!state.CanProveAbsent);
        state.Observe(true, 29, 1);
        Check(state.DescendantsAfterRoot && state.RootExitCode == 29);
        Reject(() => state.Observe(false, null, 0));
        state.BeginStop();
        Check(!state.CanProveAbsent);
        state.Observe(true, 29, 0);
        state.CompleteCleanup();
        Check(state.CanProveAbsent && state.Cleanup == "processTreeAbsent");
        var terminal = state.Snapshot();
        state.BeginStop(); state.CompleteCleanup();
        Check(terminal == state.Snapshot());
        Reject(state.BreakBridge);

        var expected = Started();
        expected.Observe(false, null, 1);
        expected.BreakBridge(); expected.LoseBridge();
        Check(expected.BridgeLost && expected.Failure is null);
        Reject(expected.BreakBridge);
        expected.BeginStop(); expected.Observe(true, 1, 0); expected.CompleteCleanup();
        Check(expected.Cleanup == "processTreeAbsent" && expected.Failure is null);

        var unexpected = Started(); unexpected.LoseBridge();
        Check(unexpected.BridgeLost && unexpected.Failure == "bridgeLost");
        unexpected.Fail("laterFailure"); Check(unexpected.Failure == "bridgeLost");
        var incomplete = Started(); incomplete.BeginStop(); incomplete.Observe(false, null, 1); incomplete.CompleteCleanup();
        Check(incomplete.Cleanup == "cleanupUnverified");
        var uncertain = new AdapterState(); uncertain.BeginStop(); uncertain.UnverifiedCleanup();
        Check(uncertain.Cleanup == "cleanupUnverified");
        var prelaunch = new AdapterState(); Reject(prelaunch.BreakBridge); prelaunch.BeginStop(); Reject(prelaunch.RequireLaunch);
        Check(prelaunch.Failure == "launchMissing");
        var normalExit = Started(); normalExit.Observe(true, 0, 0); normalExit.LoseBridge();
        Check(!normalExit.BridgeLost && normalExit.Failure is null);
    }

    private static void TestHandleAndPathContract()
    {
        Check(ProcessCreationJobAttribute.AttributeCapacity == 2);
        ProcessCreationJobAttribute.ValidateHandleList([new(10), new(11), new(12)], new(20)); checks++;
        foreach (var handles in new[] { new IntPtr[] { new(10), new(11) }, [new(10), new(11), new(11)],
            [IntPtr.Zero, new(11), new(12)], [new(-1), new(11), new(12)], [new(20), new(11), new(12)] })
            Reject(() => ProcessCreationJobAttribute.ValidateHandleList(handles, new(20)));
        Check(AdapterNativeMethods.PipeRejectRemoteClients == 8 && AdapterNativeMethods.FileFlagFirstPipeInstance != 0);
        Check(AdapterProtocol.RelayChunkBytes <= 64 * 1024 && AdapterProtocol.PipeBufferBytes <= 64 * 1024);
        Check(AdapterProtocol.WorkMilliseconds + AdapterProtocol.CleanupMilliseconds < 25000);
        Check(AdapterConfiguration.SamePath(@"C:\synthetic\case\", @"c:\synthetic\case"));
        Check(AdapterConfiguration.IsWithin(@"C:\synthetic\case\tmp", @"C:\synthetic\case"));
        Check(!AdapterConfiguration.IsWithin(@"C:\synthetic\case-other\tmp", @"C:\synthetic\case"));
        Check(!AdapterConfiguration.IsWithin(@"C:\synthetic\case\..\elsewhere", @"C:\synthetic\case"));
        Check(!AdapterConfiguration.IsWithin("relative", @"C:\synthetic"));
    }

    private static async Task TestFramesAsync()
    {
        using var valid = new MemoryStream(ControlFrame.Encode(Caller("status", 1)));
        using var read = await ControlFrame.ReadAsync(valid, CancellationToken.None);
        Check(AdapterProtocol.Caller(read!.RootElement, Generation, 0).Kind == "status");
        Check(await ControlFrame.ReadAsync(valid, CancellationToken.None) is null);
        foreach (var bytes in new[] { Encoding.UTF8.GetBytes("{\"cut\":true}"), Encoding.UTF8.GetBytes("not-json\n"),
            Enumerable.Repeat((byte)' ', 4096).ToArray(), new byte[] { 0xff, 10 } })
        {
            using var invalid = new MemoryStream(bytes);
            await RejectAsync(async () => { using var result = await ControlFrame.ReadAsync(invalid, CancellationToken.None); });
        }
        Reject(() => ControlFrame.Encode(new { text = new string('x', 4096) }));
        var exactly = Encoding.UTF8.GetBytes("{\"x\":\"" + new string('x', 4087) + "\"}\n");
        Check(exactly.Length == 4096);
        using var boundary = new MemoryStream(exactly);
        using var boundaryResult = await ControlFrame.ReadAsync(boundary, CancellationToken.None);
        Check(boundaryResult!.RootElement.GetProperty("x").GetString()!.Length == 4087);
        using var extra = new MemoryStream(Encoding.UTF8.GetBytes("{\"x\":\"" + new string('x', 4088) + "\"}\n"));
        await RejectAsync(async () => { using var result = await ControlFrame.ReadAsync(extra, CancellationToken.None); });
    }

    private static async Task TestRelayAsync()
    {
        var bytes = Enumerable.Range(0, 17000).Select(index => (byte)(index % 256)).ToArray();
        using var source = new MemoryStream(bytes);
        using var destination = new MemoryStream();
        await ByteRelay.CopyAsync(source, destination, CancellationToken.None);
        Check(destination.ToArray().SequenceEqual(bytes));
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        using var canceled = new MemoryStream(bytes);
        try { await ByteRelay.CopyAsync(canceled, destination, cancellation.Token); throw new AdapterFailure("selfTestFailed"); }
        catch (OperationCanceledException) { checks++; }
        using var stalledSource = new MemoryStream([1]);
        using var stalledDestination = new StalledStream();
        await RejectAsync(() => ByteRelay.CopyAsync(stalledSource, stalledDestination, CancellationToken.None));
        Check(AdapterOwner.SafeFailure(new IOException("private data")) == "controlIoFailed");
        Check(AdapterOwner.SafeFailure(new Exception("private data")) == "adapterInternalFailure");
    }

    private sealed class StalledStream : Stream
    {
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        { await Task.Delay(Timeout.Infinite, cancellationToken); }
    }
}
