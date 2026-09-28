using System.Text.Json;
using System.Text;

namespace Eky.ProcessOwnershipAdapter;

internal static class ElectronBridgeClientSelfTest
{
    internal static int RunChecks()
    {
        var checks = 0;
        var generation = new string('a', 64);
        var nonce = new string('b', 64);
        void Check(bool value)
        {
            if (!value) throw new AdapterFailure("electronBridgeClientSelfTestFailed");
            checks++;
        }
        void Reject(Action action)
        {
            try { action(); }
            catch (AdapterFailure) { checks++; return; }
            throw new AdapterFailure("electronBridgeClientSelfTestFailed");
        }
        ElectronBridgeClientMessage Parse(object value)
        {
            using var frame = JsonSerializer.SerializeToDocument(value, AdapterProtocol.Json);
            return ElectronBridgeClientProtocol.Parse(frame.RootElement, generation, nonce);
        }
        ElectronBridgeClientMessage Message(string kind, int? code = null) =>
            Parse(ElectronBridgeClientProtocol.Message(generation, nonce, kind, code, 15000));
        foreach (var kind in new[] { "started", "stopping", "rootExit" })
        {
            var message = Message(kind, kind == "rootExit" ? 29 : null);
            Check(message.Kind == kind && message.DeadlineTimestamp == 15000);
            Check(message.ExitCode == (kind == "rootExit" ? 29 : null));
            using var original = JsonSerializer.SerializeToDocument(
                ElectronBridgeClientProtocol.Message(generation, nonce, kind, message.ExitCode, 15000), AdapterProtocol.Json);
            var fields = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(original.RootElement.GetRawText())!;
            foreach (var key in fields.Keys)
            {
                var missing = new Dictionary<string, JsonElement>(fields);
                missing.Remove(key);
                Reject(() => Parse(missing));
            }
            var extra = new Dictionary<string, object?>(fields.Select(pair => new KeyValuePair<string, object?>(pair.Key, pair.Value)))
                { ["privatePath"] = "rejected" };
            Reject(() => Parse(extra));
            foreach (var invalid in new object?[] { null, "", "0", "-1", "+15000", "015000", "1.5", " 15000", 15000, true })
            {
                var changed = fields.ToDictionary(pair => pair.Key, pair => (object?)pair.Value);
                changed["deadlineTimestamp"] = invalid;
                Reject(() => Parse(changed));
            }
            foreach (var pair in new (string Key, object Value)[]
            {
                ("protocol", "rejected"), ("schemaVersion", 2), ("generation", nonce), ("launchNonce", generation),
                ("kind", "registered"), ("exitCode", kind == "rootExit" ? (object)"29" : 29),
            })
            {
                var changed = fields.ToDictionary(field => field.Key, field => (object?)field.Value);
                changed[pair.Key] = pair.Value;
                Reject(() => Parse(changed));
            }
        }
        foreach (var code in new[] { int.MinValue, 0, 29, int.MaxValue }) Check(Message("rootExit", code).ExitCode == code);
        foreach (var deadline in new[] { 0L, -1L })
            Reject(() => ElectronBridgeClientProtocol.Message(generation, nonce, "started", null, deadline));
        Reject(() => ElectronBridgeClientProtocol.Message(generation, nonce, "rootExit", null, 15000));
        foreach (var stopBeforeRoot in new[] { false, true })
        {
            var state = new ElectronBridgeClientState();
            Reject(state.RequireExpectedEof);
            Reject(() => state.Accept(Message("rootExit", 0)));
            state.Accept(Message("started"));
            Check(state.Started && !state.RootExited);
            Reject(() => state.Accept(Message("started")));
            if (stopBeforeRoot) state.Accept(Message("stopping"));
            state.Accept(Message("rootExit", 29));
            state.RequireExpectedEof();
            Check(state.RootExited && state.ExitCode == 29);
            if (!stopBeforeRoot) state.Accept(Message("stopping"));
            Check(state.Stopping);
            Reject(() => state.Accept(Message("stopping")));
            Reject(() => state.Accept(Message("started")));
            Reject(() => state.Accept(Message("rootExit", 29)));
        }
        var earlyStop = new ElectronBridgeClientState();
        earlyStop.Accept(Message("stopping"));
        Reject(() => earlyStop.Accept(Message("started")));
        Reject(earlyStop.RequireExpectedEof);
        long now = 1000;
        var deadlineClock = new ElectronBridgeClientDeadline(15001, 1000, () => now);
        Check(deadlineClock.RemainingMilliseconds == 14000);
        now = 2000;
        Check(deadlineClock.RemainingMilliseconds == 13000);
        deadlineClock.Shorten(25001);
        Check(deadlineClock.RemainingMilliseconds == 13000);
        deadlineClock.Shorten(5001);
        Check(deadlineClock.RemainingMilliseconds == 3000);
        now = 4500;
        Check(deadlineClock.RemainingMilliseconds == 500);
        now = 5000;
        Check(deadlineClock.RemainingMilliseconds == 0);
        Reject(deadlineClock.RequireRemaining);
        Reject(() => deadlineClock.Shorten(15001));
        now = 4999;
        Reject(deadlineClock.RequireRemaining);
        now = 6000;
        Reject(deadlineClock.RequireRemaining);
        foreach (var values in new[] { (0L, 1000L), (-1L, 1000L), (1000L, 0L), (1000L, -1L) })
            Reject(new ElectronBridgeClientDeadline(values.Item1, values.Item2, () => 1).RequireRemaining);
        var throwing = new ElectronBridgeClientDeadline(1000, 1000, () => throw new IOException());
        Reject(throwing.RequireRemaining);
        Reject(throwing.RequireRemaining);
        return checks;
    }

    internal static async Task<int> RunRelayChecksAsync()
    {
        var checks = 0;
        var generation = new string('a', 64);
        var nonce = new string('b', 64);
        string Frame(string kind, int? code = null, long deadline = 15000) => JsonSerializer.Serialize(
            ElectronBridgeClientProtocol.Message(generation, nonce, kind, code, deadline), AdapterProtocol.Json) + "\n";
        var start = Frame("started");
        var exit = Frame("rootExit", 29);
        async Task<int> Run(string frames, Action<long>? shorten = null, Stream? source = null, Stream? controlSource = null)
        {
            using var control = new MemoryStream(Encoding.UTF8.GetBytes(frames));
            using var empty = new MemoryStream();
            using var sink = new MemoryStream();
            using var errors = new MemoryStream();
            using var errorSink = new MemoryStream();
            using var bound = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            var output = new ByteRelay(source ?? empty, sink, bound.Token);
            var error = new ByteRelay(errors, errorSink, bound.Token);
            return await ElectronBridgeClientRelay.RunAsync(controlSource ?? control, output, error, generation, nonce,
                () => bound.Token.ThrowIfCancellationRequested(), shorten ?? (_ => { }), bound.Token);
        }
        foreach (var frames in new[] { start + exit, start + Frame("stopping", deadline: 5000) + exit,
            start + exit + Frame("stopping", deadline: 5000) })
        {
            if (await Run(frames) != 29) throw new AdapterFailure("electronBridgeClientSelfTestFailed");
            checks++;
        }
        // All bytes are already buffered and both output relays are settled.
        // These exercise the actual reader loop, not only the frame parser.
        foreach (var frames in new[] { "", start, exit, start + exit + exit, start + exit + start,
            start + exit + "{broken}\n", start + exit + "partial", start + exit + Frame("stopping") + Frame("stopping") })
        {
            try { await Run(frames); }
            catch (Exception failure) when (failure is AdapterFailure or JsonException) { checks++; continue; }
            throw new AdapterFailure("electronBridgeClientSelfTestFailed");
        }
        using (var control = new PendingTailStream(start + exit))
        {
            if (await Run("", controlSource: control) != 29) throw new AdapterFailure("electronBridgeClientSelfTestFailed");
            checks++;
        }
        foreach (var partial in new[] { "{", Frame("stopping")[..^1] })
        {
            using var control = new PendingTailStream(start + exit + partial);
            try { await Run("", controlSource: control); }
            catch (AdapterFailure failure) when (failure.Code == "frameTruncated") { checks++; continue; }
            throw new AdapterFailure("electronBridgeClientSelfTestFailed");
        }
        using var held = new HeldReadStream();
        long lastDeadline = 0;
        var result = await Run(start + exit + Frame("stopping", deadline: 5000), value =>
        {
            lastDeadline = value;
            if (value == 5000) held.Release();
        }, held);
        if (result != 29 || lastDeadline != 5000) throw new AdapterFailure("electronBridgeClientSelfTestFailed");
        return checks + 1;
    }

    private sealed class PendingTailStream(string content) : Stream
    {
        private readonly byte[] bytes = Encoding.UTF8.GetBytes(content);
        private int position;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (position < bytes.Length)
            {
                var count = Math.Min(buffer.Length, bytes.Length - position);
                bytes.AsMemory(position, count).CopyTo(buffer);
                position += count;
                return count;
            }
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new InvalidOperationException();
        }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }

    private sealed class HeldReadStream : Stream
    {
        private readonly TaskCompletionSource completed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal void Release() => completed.TrySetResult();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        { await completed.Task.WaitAsync(cancellationToken); return 0; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}
