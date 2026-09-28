using System.Text;
using System.Text.Json;

namespace Eky.ProcessOwnershipAdapter;

internal static partial class AdapterSelfTest
{
    private static void TestBridgeFailureEvidence()
    {
        const string privateText = "synthetic-password C:\\synthetic-private\\profile EKY_PRIVATE=value";
        var failures = new Exception[]
        {
            new IOException(privateText), new UnauthorizedAccessException(privateText),
            new JsonException(privateText), new OperationCanceledException(privateText),
            new System.ComponentModel.Win32Exception(5, privateText), new Exception(privateText),
            new AdapterFailure(privateText), new AdapterFailure("stdioHandleTypeInvalid"),
        };
        foreach (var phase in Enum.GetValues<BridgePhase>())
        {
            foreach (var failure in failures)
            {
                failure.Data["private"] = privateText;
                var bytes = BridgeFailureEvidence.Encode(Generation, phase, failure);
                Check(bytes.Length <= BridgeFailureEvidence.MaximumBytes);
                using var document = JsonDocument.Parse(bytes);
                AdapterProtocol.ExactKeys(document.RootElement, "schemaVersion", "generation", "phase", "errorCode");
                Check(document.RootElement.GetProperty("generation").GetString() == Generation);
                Check(!Encoding.UTF8.GetString(bytes).Contains(privateText, StringComparison.Ordinal));
                Check(document.RootElement.GetProperty("errorCode").GetString() == BridgeFailureEvidence.SafeCode(failure));
            }
        }
        Check(BridgeFailureEvidence.SafeCode(new AdapterFailure(privateText)) == "adapterInternalFailure");
        Check(BridgeFailureEvidence.SafeCode(new AdapterFailure("stdioHandleMissing")) == "stdioHandleMissing");
        Check(BridgeFailureEvidence.SafeCode(new AdapterFailure("stdioDuplicateFailed")) == "stdioDuplicateFailed");
        Check(BridgeFailureEvidence.SafeCode(new AdapterFailure("stdioHandleTypeInvalid")) == "stdioHandleTypeInvalid");
        Reject(() => BridgeFailureEvidence.Encode(privateText, BridgePhase.Setup, failures[0]));
        Reject(() => BridgeFailureEvidence.Encode(Generation, (BridgePhase)999, failures[0]));

        byte[]? stored = null;
        var writes = 0;
        void CreateNew(ReadOnlyMemory<byte> bytes)
        {
            writes++;
            if (stored is not null) throw new IOException("already exists");
            stored = bytes.ToArray();
        }
        Check(BridgeFailureEvidence.ExitWithFailure(Generation, BridgePhase.OpenStdout,
            new AdapterFailure("stdioHandleTypeInvalid"), CreateNew) == 1);
        var first = stored!;
        Check(first.Length > 0);
        Check(BridgeFailureEvidence.ExitWithFailure(Generation, BridgePhase.Setup, failures[0], CreateNew) == 1);
        Check(ReferenceEquals(stored, first) && writes == 2);
        Check(BridgeFailureEvidence.ExitWithFailure(Generation, BridgePhase.Setup, failures[0],
            _ => throw new UnauthorizedAccessException(privateText)) == 1);
        Check(BridgeFailureEvidence.ExitWithFailure(privateText, BridgePhase.Setup, failures[0], CreateNew) == 1);
        Check(writes == 2);
    }
}
