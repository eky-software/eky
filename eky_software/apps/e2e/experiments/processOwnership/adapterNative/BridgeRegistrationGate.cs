using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Mutations run on the existing owner's serialized control loop, not in relay callbacks.
internal sealed class BridgeRegistrationGate
{
    private readonly string generation;
    private readonly string nonce;
    private readonly uint pid;
    private readonly ulong birth;
    private readonly Action requirePeer;
    private readonly Action requireWork;
    private BridgeChallenges? challenges;
    private string? registration;
    private string phase = "new";
    internal string? Failure { get; private set; }

    internal BridgeRegistrationGate(string generation, string nonce, uint pid, ulong birth,
        Action requirePeer, Action requireWork)
    {
        BridgeRegistrationProtocol.RequireToken(generation);
        BridgeRegistrationProtocol.RequireToken(nonce);
        BridgeRegistrationProtocol.RequireIdentity(pid, birth);
        this.generation = generation; this.nonce = nonce; this.pid = pid; this.birth = birth;
        this.requirePeer = requirePeer; this.requireWork = requireWork;
    }

    internal BridgeChallenges BeginChallenges(Func<string>? tokenFactory = null)
    {
        try
        {
            RequirePhase("new");
            RequireAdmission();
            // Called only after acquiring the retained peer handle. No reused pre-acquisition nonce.
            var fresh = tokenFactory ?? BridgeRegistrationProtocol.FreshToken;
            var values = new BridgeChallenges(fresh(), fresh(), fresh());
            BridgeRegistrationProtocol.RequireChallenges(values);
            RequirePhase("new"); RequireAdmission();
            challenges = values;
            phase = "challenged";
            return values;
        }
        catch (Exception error) { throw Reject(error); }
    }

    internal string AcceptProof(JsonElement proof, Func<string>? tokenFactory = null)
    {
        try
        {
            RequirePhase("challenged"); RequireAdmission();
            BridgeRegistrationProtocol.VerifyProof(proof, generation, nonce, pid, birth, challenges!);
            var value = (tokenFactory ?? BridgeRegistrationProtocol.FreshToken)();
            BridgeRegistrationProtocol.RequireToken(value);
            if (value == challenges!.Control || value == challenges.Output || value == challenges.Error) Invalid();
            RequirePhase("challenged"); RequireAdmission();
            registration = value;
            phase = "registered";
            return value;
        }
        catch (Exception error) { throw Reject(error); }
    }

    internal void AdmitGo(string receipt)
    {
        try
        {
            RequirePhase("registered");
            if (receipt != registration) Invalid();
            RequireAdmission();
            phase = "go";
        }
        catch (Exception error) { throw Reject(error); }
    }

    internal void RequireBeforeCreateOrResume()
    {
        try { RequirePhase("go"); RequireAdmission(); }
        catch (Exception error) { throw Reject(error); }
    }

    internal void Stop() => phase = "closed";

    private void RequirePhase(string expected)
    {
        if (Failure is not null || phase != expected) Invalid();
    }

    private void RequireAdmission()
    {
        requireWork();
        requirePeer();
        requireWork();
        if (phase == "closed") Invalid();
    }

    private AdapterFailure Reject(Exception error)
    {
        Failure ??= error is AdapterFailure known && known.Code == "workDeadlineExceeded"
            ? known.Code : error is AdapterFailure invalid && invalid.Code == "bridgeRegistrationInvalid"
                ? invalid.Code : "bridgePeerObservationFailed";
        phase = "closed";
        return new AdapterFailure(Failure);
    }

    private static void Invalid() => throw new AdapterFailure("bridgeRegistrationInvalid");
}
