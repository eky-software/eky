using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static class BridgeRegistrationSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static readonly string Receipt = new('f', 64);
    private static readonly BridgeChallenges Challenges = new(new('c', 64), new('d', 64), new('e', 64));
    private static int checks;
    private static void Check(bool value) { checks++; if (!value) throw new AdapterFailure("bridgeRegistrationSelfTestFailed"); }
    private static void Reject(Action action, string code = "bridgeRegistrationInvalid")
    {
        try { action(); }
        catch (AdapterFailure failure) { Check(failure.Code == code); return; }
        throw new AdapterFailure("bridgeRegistrationSelfTestFailed");
    }

    internal static async Task<int> RunChecksAsync()
    {
        checks = 0;
        TestProof(); TestChallenges(); TestGate();
        await TestExchangeAsync();
        await TestBrokenExchangeAsync();
        await TestLateCancellationAsync();
        return checks;
    }

    private static JsonDocument Proof() => JsonSerializer.SerializeToDocument(
        BridgeRegistrationProtocol.Proof(Generation, Nonce, 19, 65535, Challenges), AdapterProtocol.Json);

    private static Func<string> Tokens()
    {
        var values = new Queue<string>([Challenges.Control, Challenges.Output, Challenges.Error]);
        return () => values.Dequeue();
    }

    private static BridgeRegistrationGate Gate(Action? peer = null, Action? work = null)
        => new(Generation, Nonce, 19, 65535, peer ?? (() => { }), work ?? (() => { }));

    private static void TestProof()
    {
        using var proof = Proof();
        void Verify(JsonElement frame) => BridgeRegistrationProtocol.VerifyProof(frame, Generation, Nonce, 19, 65535, Challenges);
        Verify(proof.RootElement); checks++;
        var original = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(proof.RootElement)!;
        foreach (var key in original.Keys)
        {
            var missing = new Dictionary<string, JsonElement>(original); missing.Remove(key);
            using var frame = JsonSerializer.SerializeToDocument(missing); Reject(() => Verify(frame.RootElement));
        }
        foreach (var (key, invalid) in new (string, object?)[]
        {
            ("protocol", "other"), ("schemaVersion", "1"), ("schemaVersion", 2), ("kind", "challenge"),
            ("generation", Nonce), ("launchNonce", Generation), ("pid", 20), ("pid", "19"), ("pid", -1), ("pid", 1.5),
            ("creationTimeFileTimeHex", "000000000000FFff"), ("creationTimeFileTimeHex", 65535),
            ("creationTimeFileTimeHex", "000000000000fffe"), ("creationTimeFileTimeHex", "ffff"),
            ("controlChallenge", Challenges.Output), ("outputChallenge", Challenges.Error), ("errorChallenge", Challenges.Output),
            ("extra", "untrusted"), ("pid", null), ("outputChallenge", new[] { Challenges.Output }),
        })
        {
            var values = new Dictionary<string, JsonElement>(original) { [key] = JsonSerializer.SerializeToElement(invalid) };
            using var frame = JsonSerializer.SerializeToDocument(values); Reject(() => Verify(frame.RootElement));
        }
        using var duplicate = JsonDocument.Parse(proof.RootElement.GetRawText().Replace("\"pid\":19", "\"pid\":19,\"pid\":19"));
        Reject(() => Verify(duplicate.RootElement));
        Reject(() => BridgeRegistrationProtocol.Proof(Generation, Nonce, 0, 65535, Challenges));
        Reject(() => BridgeRegistrationProtocol.Proof(Generation, Nonce, 19, 0, Challenges));
        Reject(() => BridgeRegistrationProtocol.Proof(Generation, Nonce, 19, ulong.MaxValue, Challenges));
        Reject(() => BridgeRegistrationProtocol.RequireChallenges(new(Challenges.Control, Challenges.Control, Challenges.Error)));
        Reject(() => BridgeRegistrationProtocol.RequireToken(new string('A', 64)));
        Reject(() => BridgeRegistrationProtocol.RequireToken(Generation + "\n"));
    }

    private static void TestChallenges()
    {
        foreach (var role in new[] { "control", "output", "error" })
        {
            using var value = JsonSerializer.SerializeToDocument(
                BridgeRegistrationProtocol.Challenge(Generation, Nonce, role, Challenges.Control), AdapterProtocol.Json);
            Check(BridgeRegistrationProtocol.ReadChallenge(value.RootElement, Generation, Nonce, role) == Challenges.Control);
            foreach (var other in new[] { "control", "output", "error" }.Where(other => other != role))
                Reject(() => BridgeRegistrationProtocol.ReadChallenge(value.RootElement, Generation, Nonce, other));
            Reject(() => BridgeRegistrationProtocol.ReadChallenge(value.RootElement, Nonce, Nonce, role));
            Reject(() => BridgeRegistrationProtocol.ReadChallenge(value.RootElement, Generation, Generation, role));
        }
        Reject(() => BridgeRegistrationProtocol.Challenge(Generation, Nonce, "stderr", Challenges.Control));
    }

    private static void TestGate()
    {
        using var proof = Proof();
        var peerChecks = 0;
        var gate = Gate(() => peerChecks++);
        Check(gate.BeginChallenges(Tokens()) == Challenges);
        Check(gate.AcceptProof(proof.RootElement, () => Receipt) == Receipt);
        gate.AdmitGo(Receipt); gate.RequireBeforeCreateOrResume(); gate.RequireBeforeCreateOrResume();
        Check(peerChecks == 7 && gate.Failure is null);
        gate.Stop(); gate.Stop(); Reject(gate.RequireBeforeCreateOrResume);
        Check(gate.Failure == "bridgeRegistrationInvalid");

        foreach (var stage in new[] { 0, 1, 2, 3 })
        {
            var current = Gate();
            if (stage >= 1) current.BeginChallenges(Tokens());
            if (stage >= 2) current.AcceptProof(proof.RootElement, () => Receipt);
            if (stage >= 3) current.AdmitGo(Receipt);
            current.Stop();
            Reject(() => current.BeginChallenges(Tokens()));
            Reject(() => current.AcceptProof(proof.RootElement));
            Reject(() => current.AdmitGo(Receipt));
            Reject(current.RequireBeforeCreateOrResume);
        }
        var premature = Gate(); Reject(() => premature.AdmitGo(Receipt)); Reject(() => premature.BeginChallenges(Tokens()));
        var repeatedChallenge = Gate(); repeatedChallenge.BeginChallenges(Tokens());
        Reject(() => repeatedChallenge.BeginChallenges(Tokens()));
        var replay = Gate(); replay.BeginChallenges(Tokens()); replay.AcceptProof(proof.RootElement, () => Receipt);
        Reject(() => replay.AcceptProof(proof.RootElement)); Reject(() => replay.AdmitGo(Receipt));
        var wrongGo = Gate(); wrongGo.BeginChallenges(Tokens()); wrongGo.AcceptProof(proof.RootElement, () => Receipt);
        Reject(() => wrongGo.AdmitGo(Challenges.Control)); Reject(() => wrongGo.AdmitGo(Receipt));
        var twice = Gate(); twice.BeginChallenges(Tokens()); twice.AcceptProof(proof.RootElement, () => Receipt); twice.AdmitGo(Receipt);
        Reject(() => twice.AdmitGo(Receipt)); Reject(twice.RequireBeforeCreateOrResume);

        foreach (var stage in new[] { 0, 1, 2, 3, 4 })
        {
            var lost = false;
            var current = Gate(() => { if (lost) throw new IOException("private error"); });
            if (stage >= 1) current.BeginChallenges(Tokens());
            if (stage >= 2) current.AcceptProof(proof.RootElement, () => Receipt);
            if (stage >= 3) current.AdmitGo(Receipt);
            if (stage >= 4) current.RequireBeforeCreateOrResume();
            lost = true;
            Action act = stage switch
            {
                0 => () => current.BeginChallenges(Tokens()), 1 => () => current.AcceptProof(proof.RootElement),
                2 => () => current.AdmitGo(Receipt), _ => current.RequireBeforeCreateOrResume,
            };
            Reject(act, "bridgePeerObservationFailed");
            lost = false; Reject(act, "bridgePeerObservationFailed");
        }
        var expired = false;
        var bounded = Gate(() => expired = true, () => { if (expired) throw new AdapterFailure("workDeadlineExceeded"); });
        Reject(() => bounded.BeginChallenges(Tokens()), "workDeadlineExceeded");
        expired = false; Reject(() => bounded.BeginChallenges(Tokens()), "workDeadlineExceeded");
        var invalidTokens = Gate(); Reject(() => invalidTokens.BeginChallenges(() => Challenges.Control));
        var factoryError = Gate(); Reject(() => factoryError.BeginChallenges(() => throw new IOException("private")), "bridgePeerObservationFailed");
        BridgeRegistrationGate? stoppedInCheck = null;
        stoppedInCheck = Gate(() => stoppedInCheck!.Stop());
        Reject(() => stoppedInCheck.BeginChallenges(Tokens()));
    }

    private static async Task TestExchangeAsync()
    {
        using var control = new MemoryStream(); using var output = new MemoryStream(); using var error = new MemoryStream();
        await BridgeRegistrationExchange.WriteChallengesAsync(control, output, error, Generation, Nonce, Challenges, CancellationToken.None);
        var outputHeader = output.ToArray(); var errorHeader = error.ToArray();
        output.Write(Encoding.UTF8.GetBytes("synthetic stdout")); error.Write(Encoding.UTF8.GetBytes("synthetic stderr"));
        control.Position = output.Position = error.Position = 0;
        Check(await BridgeRegistrationExchange.ReadChallengesAsync(control, output, error, Generation, Nonce, CancellationToken.None) == Challenges);
        Check(output.Position == outputHeader.Length && error.Position == errorHeader.Length);
        Check(output.ReadByte() == 's' && error.ReadByte() == 's');
        control.Position = 0; output.Position = 0; error.Position = 0;
        try { await BridgeRegistrationExchange.ReadChallengesAsync(control, error, output, Generation, Nonce, CancellationToken.None); }
        catch (AdapterFailure failure) { Check(failure.Code == "bridgeRegistrationInvalid"); return; }
        throw new AdapterFailure("bridgeRegistrationSelfTestFailed");
    }

    private static async Task TestBrokenExchangeAsync()
    {
        var headers = new[] { "control", "output", "error" }.Select(role => ControlFrame.Encode(
            BridgeRegistrationProtocol.Challenge(Generation, Nonce, role, role switch
            { "control" => Challenges.Control, "output" => Challenges.Output, _ => Challenges.Error }))).ToArray();
        foreach (var role in new[] { 0, 1, 2 })
        foreach (var corruption in new[] { "empty", "truncated", "oversized", "malformed" })
        {
            var frames = headers.Select(value => value.ToArray()).ToArray();
            frames[role] = corruption switch
            {
                "empty" => [], "truncated" => frames[role][..^1],
                "oversized" => Enumerable.Repeat((byte)'x', AdapterProtocol.FrameBytes).ToArray(),
                _ => Encoding.UTF8.GetBytes("{invalid}\n"),
            };
            using var control = new MemoryStream(frames[0]);
            using var output = new MemoryStream(frames[1]);
            using var error = new MemoryStream(frames[2]);
            try
            {
                await BridgeRegistrationExchange.ReadChallengesAsync(control, output, error, Generation, Nonce, CancellationToken.None);
                throw new InvalidOperationException("Missing rejection");
            }
            catch (AdapterFailure failure)
            {
                Check(failure.Code == (corruption switch
                { "empty" => "bridgeRegistrationInvalid", "truncated" => "frameTruncated",
                    "oversized" => "frameTooLarge", _ => "frameInvalid" }));
                if (role < 2) Check((role == 0 ? output : error).Position == 0);
            }
        }
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        foreach (var write in new[] { false, true })
        {
            using var control = new MemoryStream(headers[0]);
            using var output = new MemoryStream(headers[1]);
            using var error = new MemoryStream(headers[2]);
            try
            {
                if (write) await BridgeRegistrationExchange.WriteChallengesAsync(control, output, error,
                    Generation, Nonce, Challenges, cancelled.Token);
                else await BridgeRegistrationExchange.ReadChallengesAsync(control, output, error,
                    Generation, Nonce, cancelled.Token);
                throw new InvalidOperationException("Missing cancellation");
            }
            catch (OperationCanceledException) { Check(control.Position == 0 && output.Position == 0 && error.Position == 0); }
        }
    }

    private static async Task TestLateCancellationAsync()
    {
        foreach (var write in new[] { false, true })
        foreach (var role in new[] { 0, 1, 2 })
        {
            using var cancellation = new CancellationTokenSource();
            var names = new[] { "control", "output", "error" };
            var tokens = new[] { Challenges.Control, Challenges.Output, Challenges.Error };
            var streams = Enumerable.Range(0, 3).Select(index => new CancelAtCompletionStream(
                ControlFrame.Encode(BridgeRegistrationProtocol.Challenge(Generation, Nonce, names[index], tokens[index])),
                index == role ? cancellation.Cancel : () => { })).ToArray();
            try
            {
                if (write) await BridgeRegistrationExchange.WriteChallengesAsync(streams[0], streams[1], streams[2],
                    Generation, Nonce, Challenges, cancellation.Token);
                else await BridgeRegistrationExchange.ReadChallengesAsync(streams[0], streams[1], streams[2],
                    Generation, Nonce, cancellation.Token);
                throw new InvalidOperationException("Missing late cancellation");
            }
            catch (OperationCanceledException)
            {
                Check(cancellation.IsCancellationRequested);
                foreach (var stream in streams.Skip(role + 1)) Check(stream.Position == 0);
            }
            finally { foreach (var stream in streams) stream.Dispose(); }
        }
    }

    private sealed class CancelAtCompletionStream(byte[] bytes, Action cancel) : MemoryStream(bytes)
    {
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellation = default)
        {
            cancellation.ThrowIfCancellationRequested();
            var count = Read(buffer.Span);
            if (Position == Length) cancel();
            return ValueTask.FromResult(count);
        }
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellation = default)
        {
            cancellation.ThrowIfCancellationRequested();
            Write(buffer.Span);
            cancel();
            return ValueTask.CompletedTask;
        }
    }
}
