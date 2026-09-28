using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

// Playwright 1.62.1 with an explicit absolute EXE supplies these two flags and no loader.
// The caller's version guard must run before launch; this parser grants no GO authority.
internal static class ElectronBridgeLaunch
{
    private const string InspectArgument = "--inspect=0";
    private const string DebuggingArgument = "--remote-debugging-port=0";
    private const int MaximumPathCharacters = 1024;

    internal static string[] ParseLaunch(JsonElement value, ElectronServiceConfiguration config)
    {
        try
        {
            // Also enforce the transport ceiling for callers passing an already parsed element.
            if (Encoding.UTF8.GetByteCount(value.GetRawText()) >= AdapterProtocol.FrameBytes) Invalid();
            AdapterProtocol.ExactKeys(value, "protocol", "schemaVersion", "generation", "launchNonce", "kind", "cwd", "args");
            BackendServiceProtocol.Identity(value, config.Generation, ServiceProfile.ElectronBridge);
            if (AdapterProtocol.Token(value, "launchNonce") != config.LaunchNonce ||
                AdapterProtocol.Text(value, "kind", 16) != "launch" ||
                AdapterProtocol.Text(value, "cwd", MaximumPathCharacters) != config.RunRoot) Invalid();
            var source = value.GetProperty("args");
            if (source.ValueKind != JsonValueKind.Array || source.GetArrayLength() != 3) Invalid();
            var arguments = source.EnumerateArray().Select(argument =>
            {
                if (argument.ValueKind != JsonValueKind.String) Invalid();
                return argument.GetString()!;
            }).ToArray();
            RequireArguments(arguments, config);
            return arguments;
        }
        catch (Exception error) when (IsInputFailure(error)) { throw new AdapterFailure("bridgeRegistrationInvalid"); }
    }

    internal static void RequireArguments(string[] arguments, ElectronServiceConfiguration config)
    {
        try
        {
            if (config.Profile != ServiceProfile.ElectronBridge || arguments is null || arguments.Length != 3 ||
                arguments.Any(argument => argument is null || argument.Length > MaximumPathCharacters || argument.Contains('\0')) ||
                arguments[0] != InspectArgument || arguments[1] != DebuggingArgument || arguments[2] != config.Entrypoint)
                Invalid();
            BackendServiceConfiguration.RequireCanonicalSyntax(config.RunRoot);
            BackendServiceConfiguration.RequireCanonicalSyntax(config.Entrypoint);
        }
        catch (Exception error) when (IsInputFailure(error)) { throw new AdapterFailure("bridgeRegistrationInvalid"); }
    }

    private static bool IsInputFailure(Exception error) => error is AdapterFailure or InvalidOperationException or
        KeyNotFoundException or ArgumentException or JsonException;

    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new AdapterFailure("bridgeRegistrationInvalid");
}
