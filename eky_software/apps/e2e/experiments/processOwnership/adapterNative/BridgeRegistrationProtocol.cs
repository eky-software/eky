using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Eky.ProcessOwnershipAdapter;

internal sealed record BridgeChallenges(string Control, string Output, string Error);

// Private pipe frames only. None of these capability values belongs in a report.
internal static class BridgeRegistrationProtocol
{
    internal const string Name = "eky.e2e.bridge-registration";
    internal const int Version = 1;

    internal static string FreshToken() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));

    internal static void RequireToken(string value)
    {
        if (!Regex.IsMatch(value, "\\A[0-9a-f]{64}\\z", RegexOptions.CultureInvariant)) Invalid();
    }

    internal static void RequireChallenges(BridgeChallenges values)
    {
        RequireToken(values.Control); RequireToken(values.Output); RequireToken(values.Error);
        if (values.Control == values.Output || values.Control == values.Error || values.Output == values.Error) Invalid();
    }

    internal static object Challenge(string generation, string nonce, string role, string challenge)
    {
        RequireToken(generation); RequireToken(nonce); RequireToken(challenge); RequireRole(role);
        return new { protocol = Name, schemaVersion = Version, generation, launchNonce = nonce,
            kind = "challenge", role, challenge };
    }

    internal static string ReadChallenge(JsonElement value, string generation, string nonce, string role)
    {
        try
        {
            RequireRole(role);
            AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "kind", "role", "challenge");
            RequireHeader(value, generation, nonce, "challenge");
            if (AdapterProtocol.Text(value, "role", 16) != role) Invalid();
            return AdapterProtocol.Token(value, "challenge");
        }
        catch (Exception error) when (IsFrameError(error)) { throw new AdapterFailure("bridgeRegistrationInvalid"); }
    }

    internal static object Proof(string generation, string nonce, uint pid, ulong birth, BridgeChallenges challenges)
    {
        RequireToken(generation); RequireToken(nonce); RequireIdentity(pid, birth); RequireChallenges(challenges);
        return new { protocol = Name, schemaVersion = Version, generation, launchNonce = nonce, kind = "proof", pid,
            creationTimeFileTimeHex = birth.ToString("x16", CultureInfo.InvariantCulture),
            controlChallenge = challenges.Control, outputChallenge = challenges.Output, errorChallenge = challenges.Error };
    }

    internal static void VerifyProof(JsonElement value, string generation, string nonce, uint pid, ulong birth,
        BridgeChallenges challenges)
    {
        try
        {
            RequireIdentity(pid, birth); RequireChallenges(challenges);
            AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "kind", "pid",
                "creationTimeFileTimeHex", "controlChallenge", "outputChallenge", "errorChallenge");
            RequireHeader(value, generation, nonce, "proof");
            if (!value.GetProperty("pid").TryGetUInt32(out var receivedPid) || receivedPid != pid ||
                AdapterProtocol.Text(value, "creationTimeFileTimeHex", 16) != birth.ToString("x16", CultureInfo.InvariantCulture) ||
                AdapterProtocol.Token(value, "controlChallenge") != challenges.Control ||
                AdapterProtocol.Token(value, "outputChallenge") != challenges.Output ||
                AdapterProtocol.Token(value, "errorChallenge") != challenges.Error) Invalid();
        }
        catch (Exception error) when (IsFrameError(error)) { throw new AdapterFailure("bridgeRegistrationInvalid"); }
    }

    internal static void RequireIdentity(uint pid, ulong birth)
    {
        if (pid == 0 || birth == 0 || birth > long.MaxValue) Invalid();
    }

    private static void RequireHeader(JsonElement value, string generation, string nonce, string kind)
    {
        RequireToken(generation); RequireToken(nonce);
        AdapterProtocol.Identity(value, generation);
        if (AdapterProtocol.Text(value, "protocol", 64) != Name ||
            AdapterProtocol.Token(value, "launchNonce") != nonce || AdapterProtocol.Text(value, "kind", 16) != kind) Invalid();
    }

    private static void RequireRole(string role)
    {
        if (role is not ("control" or "output" or "error")) Invalid();
    }

    private static bool IsFrameError(Exception error) => error is AdapterFailure or InvalidOperationException or
        KeyNotFoundException or ArgumentException;

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new AdapterFailure("bridgeRegistrationInvalid");
}
