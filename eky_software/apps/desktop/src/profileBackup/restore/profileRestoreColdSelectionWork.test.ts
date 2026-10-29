import { randomUUID } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profileInspectionWorkMilliseconds } from '../../runtime/profileInspectionMessages.js';
import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenanceLeaseHandle } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';
import { prepareProfileRestoreColdForwardRecovery, type ProfileRestoreColdContentContext } from './prepareProfileRestoreColdForwardRecovery.js';
import { prepareProfileRestoreColdRollbackRecovery, withProfileRestoreColdRollbackAuthority } from './prepareProfileRestoreColdRollbackRecovery.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import { ProfileRestoreActivationJournalStore, profileRestoreActivationJournalFileName } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';
import type { ProfileRestoreColdCleanupContext } from './profileRestoreMutationAuthority.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([false, true])('supplies only pre-anchor ownership during preparation (revoked: %s)', async revoked => {
  const f = fixture('rollback');
  let captured: ProfileRestoreColdCleanupContext | undefined;
  const prepare = f.input.transaction.prepareColdRollbackAnchor.getMockImplementation()!;
  const first = new Error('SYNTHETIC_PRE_ANCHOR_OWNER_LOST');
  f.input.transaction.prepareColdRollbackAnchor.mockImplementation(async (...args) => {
    captured = args[3];
    expect(captured).toBeDefined(); expect(f.acquire).not.toHaveBeenCalled();
    const selections = f.selection.assertOperationSelection.mock.calls.length;
    await captured!.assertReadOwnership(); captured!.assertMutationCurrent();
    expect(f.selection.assertOperationSelection).toHaveBeenCalledTimes(selections);
    if (revoked) {
      f.input.assertAuthority = () => { throw first; };
      captured!.assertMutationCurrent();
    }
    return prepare(...args);
  });
  if (revoked) {
    await expect(f.run()).rejects.toMatchObject({ cause: first });
    expect(f.acquire).not.toHaveBeenCalled(); expect(f.content).not.toHaveBeenCalled();
  } else await expect(f.run()).resolves.toBe(f.result);
  expect(captured!.assertMutationCurrent).toThrow();
  await expect(captured!.assertReadOwnership()).rejects.toThrow();
});

for (const mode of ['forward', 'rollback'] as const) {
  describe(`cold ${mode} selection work`, () => {
    it('keeps nested readonly ownership separate from the full selection without reviving it after close', async () => {
      const f = fixture(mode);
      let captured!: ProfileRestoreColdContentContext;
      f.content.mockImplementation(async context => {
        captured = context;
        const count = f.selection.assertOperationSelection.mock.calls.length;
        expect(context.assertReadOwnership).toBeTypeOf('function');
        await context.assertReadOwnership!();
        await context.assertReadOwnership!();
        expect(f.selection.assertOperationSelection).toHaveBeenCalledTimes(count);
        await context.assertCurrent();
        expect(f.selection.assertOperationSelection).toHaveBeenCalledTimes(count + 1);
      });
      await expect(f.run()).resolves.toBe(f.result);
      const count = f.selection.assertOperationSelection.mock.calls.length;
      await expect(captured.assertReadOwnership!()).rejects.toThrow();
      await expect(captured.assertCurrent()).rejects.toThrow();
      expect(f.selection.assertOperationSelection).toHaveBeenCalledTimes(count);
      expect(f.lease.readState()).toBe('idle');
    });

    it('preserves the existing clock origin for callers without the selection port', async () => {
      const f = fixture(mode); const entered = deferred(); const finish = deferred();
      const { operationSelection: _selection, ...legacy } = f.input;
      let completed = false;
      f.main.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
      f.content.mockImplementation(async context => {
        expect(context.deadline - performance.now()).toBe(profileInspectionWorkMilliseconds);
        expect(context.assertReadOwnership).toBeUndefined();
      });
      const work = (mode === 'forward'
        ? prepareProfileRestoreColdForwardRecovery(legacy) : prepareProfileRestoreColdRollbackRecovery(legacy))
        .finally(() => { completed = true; });
      try {
        await entered.promise; await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds + 1);
        expect(completed).toBe(false); expect(f.content).not.toHaveBeenCalled();
        finish.resolve(); await expect(work).resolves.toBe(f.result);
        expect(f.lease.readState()).toBe('idle'); expect(vi.getTimerCount()).toBe(0);
      } finally { finish.resolve(); await work; }
    });

    it('keeps the first deadline across selection and native preparation', async () => {
      const f = fixture(mode);
      const deadline = f.selection.deadline;
      await vi.advanceTimersByTimeAsync(1_000);
      f.selection.assertOperationSelection.mockImplementationOnce(async assertAuthority => {
        await vi.advanceTimersByTimeAsync(1_000);
        assertAuthority();
      });
      f.content.mockImplementation(async context => {
        expect(context.deadline).toBe(deadline);
        expect(context.deadline - performance.now()).toBe(profileInspectionWorkMilliseconds - 2_000);
        await context.assertCurrent();
      });
      await expect(f.run()).resolves.toBe(f.result);
      expect(f.content).toHaveBeenCalledOnce();
      expect(f.selection.assertOperationSelection).toHaveBeenCalled();
      expect(f.selection.onUnsettledWork).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('idle');
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([0, -1, NaN, Infinity, profileInspectionWorkMilliseconds + 1])(
      'rejects an expired or oversized remaining budget (%s) before acquisition', async remaining => {
        const f = fixture(mode);
        f.selection.deadline = performance.now() + remaining;
        await expect(f.run()).rejects.toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
        expect(f.acquireLease).not.toHaveBeenCalled();
        expect(f.acquire).not.toHaveBeenCalled();
        expect(f.selection.assertOperationSelection).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it.each(['main', 'journal', 'native', 'content', 'recovery'] as const)(
      'retains ownership when the deadline overtakes pending %s work', async stage => {
        const f = fixture(mode);
        const entered = deferred(); const finish = deferred();
        const originalFinished = deferred();
        const pause = async () => {
          entered.resolve();
          try { await finish.promise; } finally { originalFinished.resolve(); }
        };
        if (stage === 'main') f.main.mockImplementationOnce(pause);
        if (stage === 'journal') f.peek.mockImplementationOnce(async () => { await pause(); return f.journal; });
        if (stage === 'native') f.acquire.mockImplementationOnce(async () => { await pause(); return f.reservation; });
        if (stage === 'content') f.content.mockImplementationOnce(async context => { await pause(); context.assertAuthority(); });
        if (stage === 'recovery') f.prepare.mockImplementationOnce(async admission => {
          await pause(); await admission!.assertCurrent(); return f.result;
        });
        const outcome = f.run().catch(error => error as Error);
        try {
          await entered.promise;
          await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
          const failure = await outcome;
          expect(failure).toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
          expect(f.selection.onUnsettledWork).toHaveBeenCalledExactlyOnceWith((failure as Error).cause);
          expect(f.lease.readState()).toBe('busy');
          expect(f.reservation.close).not.toHaveBeenCalled();
          await expect(f.lease.acquire('switch')).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
          const selections = f.selection.assertOperationSelection.mock.calls.length;
          finish.resolve(); await originalFinished.promise;
          // Observe the late original promise without relying on a real-time sleep.
          await vi.advanceTimersByTimeAsync(0);
          expect(f.selection.assertOperationSelection).toHaveBeenCalledTimes(selections);
          expect(f.selection.onUnsettledWork).toHaveBeenCalledOnce();
          expect(f.lease.readState()).toBe('busy');
          expect(f.reservation.close).not.toHaveBeenCalled();
          if (stage === 'native' || stage === 'content' || stage === 'recovery') {
            expect(f.reservation.invalidate).toHaveBeenCalled();
          }
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          finish.resolve(); await outcome; await originalFinished.promise;
          await f.held()?.release();
        }
      },
    );

    it('retains the real read handle through close and never admits a late selection', async () => {
      const f = fixture(mode);
      const root = await mkdtemp(join(tmpdir(), 'eky-cold-selection-'));
      const file = join(root, 'synthetic-selection');
      const bytes = Buffer.from('synthetic selection evidence');
      await writeFile(file, bytes);
      const entered = deferred(); const finish = deferred(); const settled = deferred();
      let handleClosed = false; let resumed = false; let passed = false;
      f.selection.assertOperationSelection.mockImplementationOnce(async assertAuthority => {
        const handle = await open(file, 'r');
        try { await handle.readFile(); }
        finally {
          entered.resolve(); await finish.promise;
          try { await handle.close(); handleClosed = true; } finally { settled.resolve(); }
        }
        assertAuthority(); resumed = true;
      });
      const outcome = f.run().catch(error => error as Error);
      try {
        await entered.promise;
        await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
        await expect(outcome).resolves.toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
        expect(handleClosed).toBe(false);
        expect(f.lease.readState()).toBe('busy');
        expect(f.acquire).not.toHaveBeenCalled();
        finish.resolve(); await settled.promise; await vi.advanceTimersByTimeAsync(0);
        expect(handleClosed).toBe(true); expect(resumed).toBe(false);
        expect(f.selection.assertOperationSelection).toHaveBeenCalledOnce();
        expect(f.lease.readState()).toBe('busy');
        expect((await readFile(file)).equals(bytes)).toBe(true);
        expect(f.prepare).not.toHaveBeenCalled();
        passed = true;
      } finally {
        finish.resolve(); await settled.promise; await outcome;
        await f.held()?.release();
        if (passed) await rm(root, { recursive: true, force: true });
      }
    });

    it('keeps the first timeout when the outer invalidation reports another failure', async () => {
      const f = fixture(mode); const entered = deferred(); const finish = deferred();
      const invalidation = new Error('synthetic outer invalidation failure');
      f.selection.onUnsettledWork.mockImplementation(() => { throw invalidation; });
      f.selection.assertOperationSelection.mockImplementationOnce(async assertAuthority => {
        entered.resolve(); await finish.promise; assertAuthority();
      });
      const outcome = f.run().catch(error => error as Error);
      try {
        await entered.promise; await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
        await expect(outcome).resolves.toMatchObject({ cause: { errors: [
          expect.objectContaining({ message: 'PROFILE_INSPECTION_TIMEOUT' }), invalidation,
        ] } });
        expect(f.lease.readState()).toBe('busy');
      } finally { finish.resolve(); await vi.advanceTimersByTimeAsync(0); await outcome; await f.held()?.release(); }
    });

    it('releases settled selection failures without entering content or recovery', async () => {
      const f = fixture(mode); const first = new Error('synthetic changed selection');
      f.selection.assertOperationSelection.mockRejectedValueOnce(first);
      await expect(f.run()).rejects.toMatchObject({ cause: first });
      expect(f.content).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
      expect(f.selection.onUnsettledWork).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('idle');
    });

    it('rejects apparent success when the recovery callback leaves an owned read pending', async () => {
      const f = fixture(mode); const entered = deferred(); const finish = deferred();
      const settled = deferred();
      f.prepare.mockImplementationOnce(async admission => {
        f.selection.assertOperationSelection.mockImplementationOnce(async assertAuthority => {
          entered.resolve(); await finish.promise; assertAuthority();
        });
        void admission!.assertCurrent().finally(() => settled.resolve()).catch(() => {});
        await entered.promise;
        return f.result;
      });
      const outcome = f.run().catch(error => error);
      try {
        await expect(outcome).resolves.toMatchObject({ cause: { message: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' } });
        expect(f.lease.readState()).toBe('busy'); expect(f.reservation.close).not.toHaveBeenCalled();
        expect(f.selection.onUnsettledWork).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ message: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' }),
        );
        finish.resolve(); await settled.promise;
        expect(f.lease.readState()).toBe('busy'); expect(f.reservation.close).not.toHaveBeenCalled();
      } finally { finish.resolve(); await settled.promise; await outcome; await f.held()?.release(); }
    });

    it('retains the lease and first cause if native close fails', async () => {
      const f = fixture(mode); const first = new Error('synthetic content failure');
      const close = new Error('synthetic close failure');
      f.content.mockRejectedValueOnce(first); f.reservation.close.mockRejectedValueOnce(close);
      await expect(f.run()).rejects.toMatchObject({ cause: { errors: [first, close] } });
      expect(f.selection.onUnsettledWork).toHaveBeenCalledExactlyOnceWith(first);
      expect(f.lease.readState()).toBe('busy');
      await f.held()?.release();
    });

    it('pins the selection callbacks and deadline before awaiting external work', async () => {
      const f = fixture(mode); const assertion = f.selection.assertOperationSelection;
      const invalidation = f.selection.onUnsettledWork; const deadline = f.selection.deadline;
      const foreignAssertion = vi.fn(async () => {}); const foreignInvalidation = vi.fn(() => {});
      const entered = deferred(); const finish = deferred();
      f.main.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
      const outcome = f.run().catch(error => error);
      try {
        await entered.promise;
        f.selection.deadline += profileInspectionWorkMilliseconds;
        f.selection.assertOperationSelection = foreignAssertion;
        f.selection.onUnsettledWork = foreignInvalidation;
        await vi.advanceTimersByTimeAsync(deadline - performance.now());
        await expect(outcome).resolves.toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
        expect(invalidation).toHaveBeenCalledOnce(); expect(assertion).not.toHaveBeenCalled();
        expect(foreignAssertion).not.toHaveBeenCalled(); expect(foreignInvalidation).not.toHaveBeenCalled();
      } finally { finish.resolve(); await vi.advanceTimersByTimeAsync(0); await outcome; await f.held()?.release(); }
    });
  });
}

it.each(['completed', 'failed', 'expired'] as const)('never revives scoped cleanup after %s rollback work', async outcome => {
  const f = fixture('rollback'); let captured!: ProfileRestoreColdCleanupContext;
  const first = new Error('synthetic cleanup failure');
  const work = withProfileRestoreColdRollbackAuthority(f.input, async admission => {
    captured = admission.coldCleanupContext!;
    expect(Object.isFrozen(captured)).toBe(true);
    const count = f.selection.assertOperationSelection.mock.calls.length;
    await captured.assertReadOwnership(); captured.assertMutationCurrent();
    expect(f.selection.assertOperationSelection).toHaveBeenCalledTimes(count);
    if (outcome === 'failed') throw first;
    if (outcome === 'expired') {
      await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
      captured.assertMutationCurrent();
    }
  }).catch(error => error);
  const result = await work;
  if (outcome === 'completed') expect(result).toBeUndefined();
  else expect(result).toBeInstanceOf(Error);
  await expect(captured.assertReadOwnership()).rejects.toThrow();
  expect(() => captured.assertMutationCurrent()).toThrow();
  await f.held()?.release();
});

it.each([false, true])('retains the owner through the actual rollback preflight postcheck (late rejection: %s)', async rejectLate => {
  const f = fixture('rollback'); const entered = deferred(); const finish = deferred(); const settled = deferred();
  const paths = { activeDatabasePath: join(tmpdir(), 'scoped', 'data', 'eky.sqlite'),
    activeDocumentsRoot: join(tmpdir(), 'scoped', 'storage', 'invoices'),
    failedRoot: join(tmpdir(), 'scoped', 'failed'), rollbackRoot: join(tmpdir(), 'scoped', 'rollback'),
    stagingRoot: join(tmpdir(), 'scoped', 'staging') };
  const transaction = new ProfileRestoreActivationTransaction({ paths, journalStore: {
    peek: f.peek, read: vi.fn(async () => f.journal), write: vi.fn(async () => {}), clear: vi.fn(async () => {}),
  } });
  vi.spyOn(transaction, 'readRollbackRecoverySources').mockResolvedValue({ databaseSlot: 'active', documentsSlot: 'active' });
  let continued = false; let checks = 0;
  const outcome = withProfileRestoreColdRollbackAuthority(f.input, async admission => {
    const preflight = transaction as unknown as { assertRollbackMutation(
      journal: Readonly<ProfileRestoreActivationJournal>, full: () => Promise<void>,
      read: { assertReadOwnership(): Promise<void> },
    ): Promise<void> };
    try {
      await preflight.assertRollbackMutation(f.journal, async () => {
        if (++checks === 2) {
          entered.resolve(); await finish.promise;
          if (rejectLate) throw new Error('synthetic late postcheck rejection');
        }
        await admission.assertCurrent();
      }, { assertReadOwnership: admission.coldCleanupContext!.assertReadOwnership });
      continued = true;
    } finally { settled.resolve(); }
  }).catch(error => error);
  try {
    await entered.promise; expect(continued).toBe(false);
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    const failure = await outcome;
    expect(failure).toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
    expect(f.lease.readState()).toBe('busy'); expect(f.reservation.close).not.toHaveBeenCalled();
    finish.resolve(); await settled.promise; await vi.advanceTimersByTimeAsync(0);
    expect(continued).toBe(false); expect(f.lease.readState()).toBe('busy');
    expect(f.reservation.close).not.toHaveBeenCalled(); expect(f.selection.onUnsettledWork).toHaveBeenCalledOnce();
    expect(await outcome).toBe(failure);
  } finally { finish.resolve(); await settled.promise; await outcome; await f.held()?.release(); }
});

it.each([false, true])('retains the owner through the actual journal mutation grant (late rejection: %s)', async rejectLate => {
  const f = fixture('rollback'); const entered = deferred(); const finish = deferred(); const settled = deferred();
  const root = await mkdtemp(join(tmpdir(), 'eky-cold-journal-grant-'));
  const path = join(root, profileRestoreActivationJournalFileName);
  const bytes = `${JSON.stringify(f.journal)}\n`;
  await writeFile(path, bytes);
  const store = new ProfileRestoreActivationJournalStore(path);
  let mutations = 0; let completed = false;
  const outcome = withProfileRestoreColdRollbackAuthority(f.input, async admission => {
    try {
      await store.write({ ...f.journal, revision: 1 }, {
        kind: 'separateContent', previous: f.journal,
        async assertCurrent() {
          entered.resolve(); await finish.promise;
          if (rejectLate) throw new Error('synthetic late journal grant rejection');
          await admission.assertCurrent();
        },
        assertContent: admission.assertContent,
        writeContext: { assertReadCurrent: admission.coldCleanupContext!.assertReadOwnership,
          assertMutationCurrent() { admission.coldCleanupContext!.assertMutationCurrent(); mutations++; } },
      });
      completed = true;
    } finally { settled.resolve(); }
  }).catch(error => error);
  let passed = false;
  try {
    await entered.promise; await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    const failure = await outcome;
    expect(failure).toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
    expect(f.lease.readState()).toBe('busy'); expect(f.reservation.close).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe(bytes);
    finish.resolve(); await settled.promise; await vi.advanceTimersByTimeAsync(0);
    expect(mutations).toBe(0); expect(completed).toBe(false);
    expect(await readFile(path, 'utf8')).toBe(bytes);
    expect(f.lease.readState()).toBe('busy'); expect(f.reservation.close).not.toHaveBeenCalled();
    expect(f.selection.onUnsettledWork).toHaveBeenCalledOnce(); expect(await outcome).toBe(failure);
    passed = true;
  } finally {
    finish.resolve(); await settled.promise; await outcome; await f.held()?.release();
    if (passed) await rm(root, { recursive: true, force: true });
  }
});

it.each(['staging', 'rollback', 'anchor'] as const)('retains acquired and late rollback claims at %s', async stage => {
  const f = fixture('rollback', true); const entered = deferred(); const finish = deferred();
  const settled = deferred(); let claimed = 0;
  f.acquire.mockImplementation(async (...args) => {
    claimed++;
    if (args[0] === stage) {
      entered.resolve(); await finish.promise; settled.resolve();
    }
    return f.reservation;
  });
  const outcome = f.run().catch(error => error);
  try {
    await entered.promise; await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    await expect(outcome).resolves.toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
    const priorClaims = claimed;
    expect(f.reservation.close).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
    finish.resolve(); await settled.promise; await vi.advanceTimersByTimeAsync(0);
    expect(claimed).toBe(priorClaims); expect(f.reservation.invalidate).toHaveBeenCalled();
    expect(f.reservation.close).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
    expect(f.selection.onUnsettledWork).toHaveBeenCalledOnce(); expect(f.lease.readState()).toBe('busy');
  } finally { finish.resolve(); await outcome; await vi.advanceTimersByTimeAsync(0); await f.held()?.release(); }
});

it('notifies the borrowed rollback owner without acquiring or releasing its lease', async () => {
  const f = fixture('rollback'); const held = await f.lease.acquire('restore');
  f.acquireLease.mockClear();
  const assertBorrowedRestoreOwner = f.lease.captureCurrentOwner(['restore'], held);
  const entered = deferred(); const finish = deferred(); const use = vi.fn(async () => {});
  f.selection.assertOperationSelection.mockImplementationOnce(async assertAuthority => {
    entered.resolve(); await finish.promise; assertAuthority();
  });
  const outcome = withProfileRestoreColdRollbackAuthority({ ...f.input, assertBorrowedRestoreOwner }, use).catch(error => error);
  try {
    await entered.promise; await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    await expect(outcome).resolves.toMatchObject({ cause: { message: 'PROFILE_INSPECTION_TIMEOUT' } });
    expect(f.acquireLease).not.toHaveBeenCalled(); expect(use).not.toHaveBeenCalled();
    expect(assertBorrowedRestoreOwner).not.toThrow();
    expect(f.selection.onUnsettledWork).toHaveBeenCalledOnce();
    finish.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(f.lease.readState()).toBe('busy');
  } finally { finish.resolve(); await outcome; await held.release(); }
});

function fixture(mode: 'forward' | 'rollback', withSources = false) {
  const journal: ProfileRestoreActivationJournal = { formatVersion: 1, operationId: randomUUID(),
    phase: mode === 'forward' ? 'prepared' : 'rolledBack', revision: 0,
    hadActiveDatabase: true, hadActiveDocuments: true };
  const lease = new InMemoryWorkspaceMaintenanceLease();
  let held: WorkspaceMaintenanceLeaseHandle | undefined;
  const acquireLease = vi.spyOn(lease, 'acquire');
  const originalAcquire = acquireLease.getMockImplementation() ?? InMemoryWorkspaceMaintenanceLease.prototype.acquire;
  acquireLease.mockImplementation(async purpose => { held = await originalAcquire.call(lease, purpose); return held; });
  let invalid = false;
  const reservation = { assertMainOwned: vi.fn(async () => {}), close: vi.fn(async () => {}),
    assertMainCurrent() { if (invalid) throw new Error('synthetic invalid owner'); },
    invalidate: vi.fn(() => { invalid = true; }), bind() { throw new Error('unused synthetic bind'); } };
  const acquire = vi.fn(async (..._args: unknown[]) => reservation);
  const main = vi.fn(async () => {}); const peek = vi.fn(async () => journal);
  const result = mode === 'forward' ? 'validateRestoredProfile' as const : 'validateRolledBackProfile' as const;
  const prepare = vi.fn<ProfileRestoreStartupRecovery['prepareBeforeBackend']>(async admission => {
    await admission!.assertCurrent(); return result;
  });
  const content = vi.fn(async (_context: ProfileRestoreColdContentContext) => {});
  const selection = { deadline: performance.now() + profileInspectionWorkMilliseconds,
    assertOperationSelection: vi.fn(async (assertAuthority: () => void) => { assertAuthority(); }),
    onUnsettledWork: vi.fn((_cause: unknown) => {}) };
  const input = { journal, stagingRoot: tmpdir(), maintenanceLease: lease, assertMainOwned: main,
    assertAuthority() {}, journalStore: { peek }, acquireReservation: acquire,
    assertContent: content, recovery: { prepareBeforeBackend: prepare }, operationSelection: selection,
    transaction: { prepareColdRollbackAnchor: vi.fn<ProfileRestoreActivationTransaction['prepareColdRollbackAnchor']>(async (_selected, claim) => {
      if (withSources) await claim([
        { root: 'staging', role: 'staging', identity: 's'.repeat(64) },
        { root: 'rollback', role: 'rollback', identity: 'r'.repeat(64) },
      ]);
      return { anchorRoot: 'anchor', anchorIdentity: 'a'.repeat(64), sources: [] };
    }) } };
  return { journal, lease, acquireLease, held: () => held, selection, main, peek, acquire, reservation,
    prepare, content, result, input, run: () => mode === 'forward'
      ? prepareProfileRestoreColdForwardRecovery(input) : prepareProfileRestoreColdRollbackRecovery(input) };
}
