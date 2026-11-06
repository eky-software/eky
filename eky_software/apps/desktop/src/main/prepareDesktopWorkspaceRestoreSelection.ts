import { profileInspectionWorkMilliseconds } from '../runtime/profileInspectionMessages.js';
import { waitForInspectionPhase } from '../profileBackup/inspectOwnedEncryptedProfileBackup.js';
import { captureWorkspaceBackupReplacementStartupSelection } from '../workspaces/replacement/workspaceBackupReplacementStartupBinding.js';
import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';

type Capture = typeof captureWorkspaceBackupReplacementStartupSelection;

/** Main preparation only: the cold caller supplies its deadline; backend prepare owns its signal. */
export async function prepareDesktopWorkspaceRestoreSelection(input: Readonly<{
  selection: Parameters<Capture>[0];
  sources: Parameters<Capture>[2];
  maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
  assertAuthority(): void;
  assertMainOwned(): Promise<void>;
  assertJournalSelection(): Promise<void>;
  onUnsettledWork(cause: unknown): void;
  deadline?: number;
  signal?: AbortSignal;
}>) {
  const captureInput = structuredClone(input.selection);
  const sources = {
    registry: { inspectSlots: input.sources.registry.inspectSlots.bind(input.sources.registry) },
    switchJournal: { inspectSlots: input.sources.switchJournal.inspectSlots.bind(input.sources.switchJournal) },
  };
  const maintenance = input.maintenanceLease;
  const assertAuthority = input.assertAuthority.bind(input);
  const assertMainOwned = input.assertMainOwned.bind(input);
  const assertJournalSelection = input.assertJournalSelection.bind(input);
  const onUnsettledWork = input.onUnsettledWork.bind(input);
  const deadline = input.deadline;
  const signal = input.signal;
  if ((deadline === undefined) === (signal === undefined)) throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
  const cancellation = new AbortController();
  let closed = false;
  let settled = false;
  let retained = false;
  let firstFailure: { cause: unknown } | undefined;
  const extraFailures: unknown[] = [];
  let selected: Awaited<ReturnType<Capture>> | undefined;
  let lease: Awaited<ReturnType<typeof maintenance.acquire>> | undefined;
  let assertLease = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retain = (cause: unknown) => {
    if (retained || settled) return;
    retained = true;
    closed = true;
    firstFailure ??= { cause };
    selected?.close();
    try { onUnsettledWork(firstFailure.cause); } catch (error) { extraFailures.push(error); }
  };
  const abort = () => {
    closed = true;
    retain(new Error('PROFILE_INSPECTION_TIMEOUT'));
    cancellation.abort();
  };
  const assertCurrent = () => {
    if (closed || cancellation.signal.aborted || signal?.aborted ||
        (deadline !== undefined && performance.now() >= deadline)) throw new Error('PROFILE_INSPECTION_TIMEOUT');
    const authorityResult: unknown = assertAuthority();
    if (authorityResult !== undefined) {
      void Promise.resolve(authorityResult).catch(() => undefined);
      throw new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    }
    assertLease();
  };
  if (deadline !== undefined) {
    const remaining = deadline - performance.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > profileInspectionWorkMilliseconds) {
      throw new Error('PROFILE_INSPECTION_TIMEOUT');
    }
    timer = setTimeout(abort, remaining);
  } else {
    signal!.addEventListener('abort', abort, { once: true });
    if (signal!.aborted) abort();
  }
  const original = Promise.resolve().then(async () => {
    try {
      assertCurrent();
      lease = await maintenance.acquire('restore');
      assertLease = maintenance.captureCurrentOwner(['restore'], lease);
      assertCurrent();
      await assertMainOwned();
      assertCurrent();
      await assertJournalSelection();
      assertCurrent();
      selected = await captureWorkspaceBackupReplacementStartupSelection(captureInput, assertCurrent, sources);
      assertCurrent();
      await assertJournalSelection();
      assertCurrent();
      await assertMainOwned();
      assertCurrent();
      return selected;
    } catch (error) { firstFailure ??= { cause: error }; selected?.close(); throw error; }
    finally {
      closed = true;
      if (!retained && lease !== undefined) {
        try { await lease.release(); }
        catch (error) {
          if (firstFailure !== undefined && firstFailure.cause !== error) extraFailures.push(error);
          firstFailure ??= { cause: error }; retain(error); throw error;
        }
      }
      settled = true;
    }
  });
  // Observe late failure without mistaking this observer for the original task's settlement.
  void original.catch(() => undefined);
  try {
    // Backend prepare must return the whole task to its existing shutdown owner.
    return deadline === undefined ? await original : await waitForInspectionPhase(original, cancellation.signal);
  } catch (error) {
    firstFailure ??= { cause: error };
    if (!settled) retain(firstFailure.cause);
    if (extraFailures.length !== 0) throw new AggregateError([firstFailure.cause, ...extraFailures], 'PROFILE_RESTORE_RECOVERY_REQUIRED');
    throw firstFailure.cause;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    closed = true;
    cancellation.abort();
  }
}
