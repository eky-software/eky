using System.Text.Json;
using Eky.WindowsProcessSupervisor;

namespace Eky.AdmittedSourceTransport;

// In-memory close-hook controls only. No Windows Job, reservation or source is opened.
internal static class JointReservationCloseControls
{
    internal static int Run()
    {
        var rows = new List<object>();
        string? firstFailure = null;
        void Check(string name, Action test)
        {
            Exception? failure = null;
            try { test(); }
            catch (Exception error) { failure = error; firstFailure ??= name; }
            rows.Add(new { name, passed = failure is null,
                failure = failure is null ? null : new { type = failure.GetType().Name, failure.HResult } });
        }
        static void Require(bool value) { if (!value) throw new InvalidDataException("jointCloseControlFailed"); }
        static SourceHandoffPrototype Create(SourceAdmissionExperiment proof) => new(
            new SourceHandoffContext(null!, "sourceHold", null!, "", new Dictionary<string, string>(),
                null!, Array.Empty<string>(), proof), null!, () => 17);

        Check("actualClosePrecedesCallbackAndNotifiesOnce", () =>
        {
            var proof = new SourceAdmissionExperiment("sourceHold");
            var source = Create(proof);
            var calls = 0;
            proof.SourceReservationCloseRequested = elapsed =>
            {
                Require(source.AdmissionClosed && elapsed == 17);
                calls++;
            };
            try
            {
                source.CloseAdmission();
                source.CloseAdmission();
                Require(calls == 1 && proof.CleanupFailure is null);
            }
            finally { source.ReleaseSettledHandles(); }
        });
        Check("callbackFailureCannotReplaceExistingFirstFailure", () =>
        {
            var proof = new SourceAdmissionExperiment("sourceHold");
            proof.ObserveFirst(new OperationCanceledException("syntheticOriginalCancellation"));
            var original = proof.FirstFailure;
            var source = Create(proof);
            proof.SourceReservationCloseRequested = _ => throw new IOException("syntheticCloseObserverFailure");
            try
            {
                source.CloseAdmission();
                Require(source.AdmissionClosed && ReferenceEquals(original, proof.FirstFailure) && proof.CleanupFailure is not null);
            }
            finally { source.ReleaseSettledHandles(); }
        });
        Check("actualCancellationFailureSurvivesThrowingCallback", () =>
        {
            var proof = new SourceAdmissionExperiment("sourceHold");
            var source = Create(proof);
            // Deliberately dispose the unstarted operation's CTS so its real Cancel throws.
            source.ReleaseSettledHandles();
            var calls = 0;
            proof.SourceReservationCloseRequested = _ =>
            {
                calls++;
                throw new IOException("syntheticCloseObserverAfterCancelFailure");
            };
            Exception? actual = null;
            try { source.CloseAdmission(); }
            catch (Exception error) { actual = error; }
            Require(actual is ObjectDisposedException && source.AdmissionClosed && calls == 1 && proof.CleanupFailure is not null);
            var cleanup = proof.CleanupFailure;
            proof.ObserveFirst(actual!);
            Require(proof.FirstFailure is not null && ReferenceEquals(cleanup, proof.CleanupFailure));
            source.CloseAdmission();
            Require(calls == 1);
        });
        Check("missingCallbackDoesNotPreventClose", () =>
        {
            var proof = new SourceAdmissionExperiment("sourceHold");
            var source = Create(proof);
            try
            {
                source.CloseAdmission();
                Require(source.AdmissionClosed && proof.FirstFailure is null && proof.CleanupFailure is null);
            }
            finally { source.ReleaseSettledHandles(); }
        });
        Check("unsettledReleaseCannotUpgradeDeadline", () =>
        {
            var original = SupervisorOutcome.Failed("deadlineExceeded", "processTreeAbsent", true,
                childExitCode: 7, processWin32ErrorCode: 5);
            var actual = AcceptanceCommandProgram.ProjectReservationCompletion(original, false, false);
            Require(actual.Status == "failed" && actual.ProcessResultCode == original.ProcessResultCode &&
                actual.WorkerResultCode == original.WorkerResultCode && actual.ChildExitCode == original.ChildExitCode &&
                actual.ProcessWin32ErrorCode == original.ProcessWin32ErrorCode &&
                !actual.ProcessTreeAbsent && !actual.HostOperationsCompleted && actual.CleanupResultCode == "cleanupUnverified");
        });
        Check("preparedPinsRequireProcessAbsenceAndSettledHostWork", () =>
        {
            var settled = SupervisorOutcome.Failed("deadlineExceeded", "processTreeAbsent", true)
                with { HostOperationsCompleted = true };
            Require(AcceptanceCommandProgram.CanReleasePreparedAdmission(false, null, true));
            Require(!AcceptanceCommandProgram.CanReleasePreparedAdmission(false, null, false));
            Require(!AcceptanceCommandProgram.CanReleasePreparedAdmission(true, null, true));
            Require(!AcceptanceCommandProgram.CanReleasePreparedAdmission(true, settled with { ProcessTreeAbsent = false }, true));
            Require(!AcceptanceCommandProgram.CanReleasePreparedAdmission(true, settled with { HostOperationsCompleted = false }, true));
            Require(!AcceptanceCommandProgram.CanReleasePreparedAdmission(true, settled, false));
            Require(AcceptanceCommandProgram.CanReleasePreparedAdmission(true, settled, true));
        });

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = 1, operation = "jointReservationCloseControls",
            status = firstFailure is null ? "completed" : "failed", controls = rows.Count, rows, firstFailure,
            actualReservationAttempted = false, sourceProcessStarted = false,
            physicalCleanupProved = false, fullCommandAccepted = false,
        }));
        return firstFailure is null ? 0 : 1;
    }
}
