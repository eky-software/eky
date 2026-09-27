using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Controlled I/O completion exercises the owner's real registration driver without an OS process.
internal static class ElectronBridgeRegistrationSelfTest
{
    private static readonly string Generation = new('a', 64);
    private static readonly string Nonce = new('b', 64);
    private static int checks;
    private static void Check(bool value) { checks++; if (!value) throw new AdapterFailure("bridgeDriverSelfTestFailed"); }
    private static void Reject(Action action)
    {
        try { action(); }
        catch (AdapterFailure) { checks++; return; }
        throw new AdapterFailure("bridgeDriverSelfTestFailed");
    }

    internal static async Task<int> RunChecksAsync()
    {
        checks = 0;
        using (var test = new PendingRegistration())
        {
            test.Driver.Begin(19);
            test.Driver.Advance();
            Check(test.Acquisitions == 0 && test.Driver.Receipt is null);
            test.Connected.SetResult(); test.Driver.Advance();
            Check(test.Acquisitions == 1 && test.Driver.Receipt is null);
            test.CompleteProof();
            Check(test.Driver.Receipt is null); // Completing I/O alone cannot grant a receipt.
            test.Driver.Advance();
            var receipt = test.Driver.Receipt!;
            Check(receipt.Length == 64);
            var args = test.Driver.AdmitGo(receipt);
            args[0] = "changed caller copy";
            test.Driver.RequireBeforeCreateOrResume();
            test.Driver.RequireBeforeCreateOrResume();
            Check(test.Acquisitions == 1 && test.Arguments[0] == "synthetic-entry");
            Reject(() => test.Driver.AdmitGo(receipt));
            test.Driver.Stop();
            Reject(test.Driver.RequireBeforeCreateOrResume);
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, (string?)null));
        }
        // Stop wins even if the transport ignores cancellation and completes successfully later.
        foreach (var phase in new[] { 0, 1, 2, 3, 4 })
        {
            using var test = new PendingRegistration();
            if (phase >= 1) test.Driver.Begin(19);
            if (phase >= 2) { test.Connected.SetResult(); test.Driver.Advance(); }
            if (phase >= 3) test.CompleteProof();
            if (phase >= 4) test.Driver.Advance();
            var formerReceipt = test.Driver.Receipt ?? new string('f', 64);
            test.Driver.Stop(); test.Driver.Stop();
            test.Connected.TrySetResult();
            if (test.Challenges is not null) test.CompleteProof();
            test.Driver.Advance();
            Check(test.Driver.Receipt is null);
            Reject(() => test.Driver.AdmitGo(formerReceipt));
            Reject(() => test.Driver.Begin(19));
            Reject(test.Driver.RequireBeforeCreateOrResume);
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, (string?)null));
            Check(test.Acquisitions == (phase >= 2 ? 1 : 0));
        }
        using (var test = new PendingRegistration())
        {
            test.Driver.Begin(19); test.Driver.Stop();
            using var bound = new CancellationTokenSource(); bound.Cancel();
            Check(await test.Driver.SettleAsync(bound.Token) == (false, (string?)null));
            test.Connected.SetResult();
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, (string?)null));
        }
        using (var test = new PendingRegistration())
        {
            test.Driver.Begin(19); test.Connected.SetException(new IOException("private transport failure"));
            try { test.Driver.Advance(); throw new AdapterFailure("bridgeDriverSelfTestFailed"); }
            catch (IOException) { checks++; }
            test.Driver.Stop();
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, "ownerFailed"));
            Check(test.Acquisitions == 0 && test.Driver.Receipt is null);
        }
        foreach (var boundary in new[] { "proof", "go", "create", "resume" })
        {
            using var test = new PendingRegistration();
            test.Driver.Begin(19); test.Connected.SetResult(); test.Driver.Advance(); test.CompleteProof();
            if (boundary == "proof") test.PeerLost = true;
            else test.Driver.Advance();
            var receipt = test.Driver.Receipt;
            if (boundary is "create" or "resume") test.Driver.AdmitGo(receipt!);
            if (boundary == "resume") test.Driver.RequireBeforeCreateOrResume();
            test.PeerLost = true;
            if (boundary == "proof") Reject(test.Driver.Advance);
            else if (boundary == "go") Reject(() => test.Driver.AdmitGo(receipt!));
            else Reject(test.Driver.RequireBeforeCreateOrResume);
            test.PeerLost = false;
            Reject(test.Driver.RequireBeforeCreateOrResume);
            test.Driver.Stop();
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, (string?)null));
        }
        using (var test = new PendingRegistration())
        {
            test.Driver.Begin(19); test.Connected.SetResult(); test.Driver.Advance(); test.CompleteProof();
            test.Expired = true;
            Reject(test.Driver.Advance);
            Check(test.Driver.Receipt is null);
            test.Driver.Stop();
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, (string?)null));
        }
        await TestStopTransportOutcomesAsync();
        return checks;
    }

    private static async Task TestStopTransportOutcomesAsync()
    {
        foreach (var exchange in new[] { false, true })
        foreach (var late in new[] { false, true })
        foreach (var failure in new Exception[]
        {
            new IOException("private transport failure"), new AdapterFailure("bridgeRegistrationInvalid"),
            new AdapterFailure("frameInvalid"), new AdapterFailure("bridgePeerExited"),
        })
        {
            using var test = new PendingRegistration();
            test.Driver.Begin(19);
            if (exchange) { test.Connected.SetResult(); test.Driver.Advance(); }
            if (!late) test.FailTransport(exchange, failure);
            test.Driver.Stop();
            Check(test.Driver.Failure == (late ? null : ElectronBridgeServiceProtocol.OperationalFailure(failure)));
            var settling = test.Driver.SettleAsync(CancellationToken.None);
            if (late) { Check(!settling.IsCompleted); test.FailTransport(exchange, failure); }
            test.Driver.Advance();
            Check(test.Driver.Receipt is null);
            var result = await settling;
            Check(result == (true, ElectronBridgeServiceProtocol.OperationalFailure(failure)));
            Check(test.Driver.Failure == result.Failure);
            Check(await test.Driver.SettleAsync(CancellationToken.None) == result);
            Check(test.Acquisitions == (exchange ? 1 : 0));
            Reject(() => test.Driver.AdmitGo(new string('f', 64)));
        }

        foreach (var exchange in new[] { false, true })
        foreach (var late in new[] { false, true })
        foreach (var tokenKind in new[] { "own", "other", "none" })
        {
            using var test = new PendingRegistration();
            using var other = new CancellationTokenSource();
            other.Cancel();
            test.Driver.Begin(19);
            if (exchange) { test.Connected.SetResult(); test.Driver.Advance(); }
            var token = tokenKind switch { "own" => test.TransportToken, "other" => other.Token, _ => CancellationToken.None };
            if (!late) test.CancelTransport(exchange, token);
            test.Driver.Stop();
            Check(test.TransportToken.IsCancellationRequested);
            var settling = test.Driver.SettleAsync(CancellationToken.None);
            if (late) { Check(!settling.IsCompleted); test.CancelTransport(exchange, token); }
            var result = await settling;
            Check(result == (true, late && tokenKind == "own" ? (string?)null : "ownerFailed"));
            Check(test.Driver.Receipt is null);
            test.Driver.Advance();
            Reject(test.Driver.RequireBeforeCreateOrResume);
        }

        foreach (var exchange in new[] { false, true })
        {
            using var test = new PendingRegistration();
            test.Driver.Begin(19);
            if (exchange) { test.Connected.SetResult(); test.Driver.Advance(); }
            using var onCancel = test.TransportToken.Register(() => test.CancelTransport(exchange, test.TransportToken));
            test.Driver.Stop();
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, (string?)null));
            Check(test.Driver.Receipt is null);
        }

        foreach (var exchange in new[] { false, true })
        {
            using var test = new PendingRegistration();
            test.Driver.Begin(19);
            if (exchange) { test.Connected.SetResult(); test.Driver.Advance(); }
            test.Driver.Stop();
            var settling = test.Driver.SettleAsync(CancellationToken.None);
            Check(!settling.IsCompleted);
            if (exchange) test.CompleteProof(); else test.Connected.SetResult();
            Check(await settling == (true, (string?)null));
            test.Driver.Advance();
            Check(test.Driver.Receipt is null && test.Acquisitions == (exchange ? 1 : 0));
            Reject(() => test.Driver.AdmitGo(new string('f', 64)));
        }

        // Ignoring a matching cancellation must not hide another failure in an aggregate.
        using (var test = new PendingRegistration())
        {
            test.Driver.Begin(19); test.Driver.Stop();
            test.FailTransport(false, new AggregateException(new OperationCanceledException(test.TransportToken),
                new AdapterFailure("bridgeRegistrationInvalid")));
            Check(await test.Driver.SettleAsync(CancellationToken.None) == (true, "launchRejected"));
            Check(test.Driver.Receipt is null && test.Acquisitions == 0);
        }

        using (var test = new PendingRegistration())
        {
            test.Driver.Begin(19); test.Connected.SetResult(); test.Driver.Advance();
            test.FailTransport(true, new AdapterFailure("frameInvalid"));
            test.Driver.Stop();
            using var expired = new CancellationTokenSource(); expired.Cancel();
            Check(await test.Driver.SettleAsync(expired.Token) == (false, "protocolInvalid"));
        }
    }

    private sealed class PendingRegistration : IDisposable
    {
        internal readonly TaskCompletionSource Connected = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<ElectronBridgeProof> proof = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly string[] Arguments = ["synthetic-entry"];
        internal BridgeChallenges? Challenges;
        internal bool PeerLost;
        internal bool Expired;
        internal int Acquisitions;
        internal CancellationToken TransportToken;
        internal readonly ElectronBridgeRegistration Driver;

        internal PendingRegistration()
        {
            void Work() { if (Expired) throw new AdapterFailure("workDeadlineExceeded"); }
            void Peer() { if (PeerLost) throw new AdapterFailure("bridgePeerExited"); }
            Driver = new(token => { TransportToken = token; return Connected.Task; },
                pid => { Check(pid == 19); Acquisitions++; return new(Generation, Nonce, pid, 65535, Peer, Work); },
                (values, token) => { Check(token == TransportToken); Challenges = values; return proof.Task; }, Work);
        }

        internal void FailTransport(bool exchange, Exception failure)
        {
            if (exchange) proof.SetException(failure); else Connected.SetException(failure);
        }

        internal void CancelTransport(bool exchange, CancellationToken token)
        {
            if (exchange) proof.SetCanceled(token); else Connected.SetCanceled(token);
        }

        internal void CompleteProof()
        {
            using var document = JsonSerializer.SerializeToDocument(
                BridgeRegistrationProtocol.Proof(Generation, Nonce, 19, 65535, Challenges!), AdapterProtocol.Json);
            proof.TrySetResult(new(document.RootElement.Clone(), Arguments));
        }

        public void Dispose() => Driver.Dispose();
    }
}
