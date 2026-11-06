import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import { profileInspectionFailureCauses } from '../../runtime/profileInspectionFailure.js';
import type { ProfileRestoreActivationJournal, ProfileRestoreActivationPhase } from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import type { ProfileRestoreColdRollbackAdmission, ProfileRestoreRollbackAcceptance,
  ProfileRestoreRolledBackCleanup, ProfileRestoreValidatedRollback } from './profileRestoreStartupRecovery.js';

describe('profile restore startup recovery', () => {
  it('finishes rolled-back cleanup inside the validated owner before reporting ready', async () => {
    const f = validatedRollbackFixture();
    let ownerActive = false;
    f.syncGuard.mockImplementation(() => { expect(ownerActive).toBe(true); });
    f.clear.mockImplementation(async (_journal, guard, _root, _cold, mutation) => {
      expect(ownerActive).toBe(true); await guard!(); mutation!();
    });
    const mode = await f.recovery.prepareBeforeBackend();
    await expect(f.run(mode, async use => {
      ownerActive = true;
      try { await use(f.report); } finally { ownerActive = false; }
    })).resolves.toBe('ready');
    expect(f.clear).toHaveBeenCalledOnce(); expect(f.syncGuard).toHaveBeenCalled();
    expect(f.validateLegacy).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    expect(f.events.map(event => event.eventName)).toEqual(['restore.validationCompleted']);
  });

  it.each(['validation', 'cleanup', 'close'] as const)('retains the first %s failure and its recovery stage', async stage => {
    const f = validatedRollbackFixture(); const first = new Error('PROFILE_INSPECTION_TIMEOUT');
    const stop = new Error('SYNTHETIC_STOP_FAILURE'); f.stop.mockRejectedValueOnce(stop);
    if (stage === 'cleanup') f.clear.mockRejectedValueOnce(first);
    const mode = await f.recovery.prepareBeforeBackend();
    await expect(f.run(mode, async use => {
      if (stage === 'validation') throw first;
      await use(f.report);
      if (stage === 'close') throw first;
    })).rejects.toMatchObject({ cause: { errors: [first, stop] } });
    expect(f.transaction.rollback).not.toHaveBeenCalled();
    if (stage === 'validation') expect(f.clear).not.toHaveBeenCalled();
    expect(f.events.map(event => event.eventName)).toEqual([
      stage === 'validation' ? 'restore.validationFailed' : 'restore.validationCompleted', 'restore.recoveryRequired',
    ]);
    if (stage === 'cleanup') expect(f.report).toHaveBeenCalledExactlyOnceWith(first);
  });

  it.each(['unused', 'caughtRepeat', 'caughtNestedRepeat'] as const)('denies ready after %s and seals late use', async kind => {
    const f = validatedRollbackFixture();
    let late: Parameters<ProfileRestoreValidatedRollback>[0] | undefined;
    if (kind === 'caughtNestedRepeat') f.withCleanup.mockImplementation(async (_journal, use) => {
      await use(f.guard, f.syncGuard);
      try { await use(f.guard, f.syncGuard); } catch { /* Deliberately swallowed owner violation. */ }
    });
    const mode = await f.recovery.prepareBeforeBackend();
    await expect(f.run(mode, async use => {
      late = use;
      if (kind === 'unused') return;
      await use(f.report);
      if (kind === 'caughtRepeat') await use(f.report).catch(() => {});
    })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    const calls = f.clear.mock.calls.length;
    await expect(late!(f.report)).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
    expect(f.clear).toHaveBeenCalledTimes(calls);
    expect(calls).toBe(kind === 'unused' ? 0 : 1);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it.each(['missingOwner', 'missingGuard', 'asynchronousGuard'] as const)('denies validated cleanup with %s', async kind => {
    const f = validatedRollbackFixture(kind === 'missingOwner');
    if (kind === 'missingGuard') f.withCleanup.mockImplementation(async (_journal, use) => { await use(f.guard); });
    if (kind === 'asynchronousGuard') f.syncGuard.mockImplementation(() => Promise.reject(new Error('ASYNC_GUARD')));
    f.clear.mockImplementation(async (_journal, _guard, _root, _cold, mutation) => { mutation!(); });
    const mode = await f.recovery.prepareBeforeBackend();
    await expect(f.run(mode, async use => { await use(f.report); })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    if (kind !== 'asynchronousGuard') expect(f.clear).not.toHaveBeenCalled();
    expect(f.transaction.rollback).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce();
  });

  it('reports an owner failure before joining unfinished cleanup inside the validator', async () => {
    const f = validatedRollbackFixture(); const entered = continuationGate(); const finish = continuationGate();
    const reported = continuationGate();
    f.report.mockImplementation(() => { reported.resolve(); });
    const first = new Error('SYNTHETIC_OWNER_FAILURE');
    f.guard.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
    f.withCleanup.mockImplementation(async (_journal, use) => {
      void use(f.guard, f.syncGuard).catch(() => {});
      await entered.promise;
      throw first;
    });
    const mode = await f.recovery.prepareBeforeBackend();
    let completed = false;
    const outcome = f.run(mode, async use => { await use(f.report); }).catch(error => error)
      .finally(() => { completed = true; });
    try {
      await entered.promise;
      await reported.promise;
      expect(f.report).toHaveBeenCalledExactlyOnceWith(first);
      expect(completed).toBe(false); expect(f.stop).not.toHaveBeenCalled();
    } finally { finish.resolve(); await outcome; }
    expect((await outcome).cause.errors[0]).toBe(first);
    expect(f.clear).not.toHaveBeenCalled();
  });

  it.each(['return', 'throw'] as const)('does not add an outer join or allow late writes after the validator %s', async kind => {
    const f = validatedRollbackFixture(); const entered = continuationGate(); const finish = continuationGate();
    const first = new Error('SYNTHETIC_VALIDATOR_CLOSED');
    let pending: Promise<void> | undefined; let mutations = 0;
    f.clear.mockImplementation(async (_journal, _guard, _root, _cold, mutation) => {
      entered.resolve(); await finish.promise; mutation!(); mutations++;
    });
    const mode = await f.recovery.prepareBeforeBackend();
    const outcome = f.run(mode, async use => {
      pending = use(f.report); void pending.catch(() => {});
      await entered.promise;
      if (kind === 'throw') throw first;
    }).catch(error => error);
    try {
      await entered.promise;
      expect(await outcome).toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
      expect(f.stop).toHaveBeenCalledOnce();
      // Late completion must not clear the journal selected by a subsequent startup.
      await f.recovery.prepareBeforeBackend();
    } finally { finish.resolve(); await pending?.catch(() => {}); await outcome; }
    expect(mutations).toBe(0);
    f.clear.mockImplementation(async (_journal, guard, _root, _cold, mutation) => { await guard!(); mutation!(); });
    await expect(f.run(mode, async use => { await use(f.report); })).resolves.toBe('ready');
  });

  it.each([null, undefined])('does not replace a nullish first cleanup cause (%s)', async first => {
    const f = validatedRollbackFixture(); f.clear.mockRejectedValueOnce(first);
    const mode = await f.recovery.prepareBeforeBackend();
    const error = await f.run(mode, async use => { await use(f.report).catch(() => {}); }).catch(cause => cause);
    expect(error.cause.errors[0]).toBe(first);
    expect(f.report).toHaveBeenCalledExactlyOnceWith(first);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it.each(['asynchronous', 'synchronous'] as const)('records the first %s guard failure before transaction finalization', async kind => {
    const f = validatedRollbackFixture(); const failed = continuationGate(); const finish = continuationGate();
    const first = new Error('SYNTHETIC_FIRST_GUARD_FAILURE'); const second = new Error('SYNTHETIC_OWNER_FAILURE');
    if (kind === 'synchronous') f.syncGuard.mockImplementation(() => { throw first; });
    else f.guard.mockImplementation(async () => { if (f.guard.mock.calls.length === 2) throw first; });
    f.clear.mockImplementation(async (_journal, guard, _root, _cold, mutation) => {
      try { if (kind === 'synchronous') mutation!(); else await guard!(); }
      catch (error) { failed.resolve(); await finish.promise; throw error; }
    });
    f.withCleanup.mockImplementation(async (_journal, use) => {
      void use(f.guard, f.syncGuard).catch(() => {});
      await failed.promise;
      throw second;
    });
    const mode = await f.recovery.prepareBeforeBackend();
    const outcome = f.run(mode, async use => { await use(f.report); }).catch(error => error);
    try {
      await failed.promise;
      expect(f.report).toHaveBeenCalledExactlyOnceWith(first);
      expect(f.stop).not.toHaveBeenCalled();
    } finally { finish.resolve(); await outcome; }
    expect((await outcome).cause.errors[0]).toBe(first);
    expect(f.transaction.rollback).not.toHaveBeenCalled();
  });

  it('consumes cleanup permission before an authority callback can re-enter', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    let reentries = 0;
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, 'rolledBack') },
      transaction,
      async withRolledBackCleanupAuthority(_journal, use) {
        await use(async () => {
          reentries++;
          expect(() => use(async () => {})).toThrow('PROFILE_RESTORE_DECISION_INVALID');
        });
      },
    });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode,
      async stopBackend() {}, async validateActiveProfile() {},
    })).resolves.toBe('ready');
    expect(reentries).toBeGreaterThan(0);
    expect(transaction.clearRolledBack).toHaveBeenCalledOnce();
  });

  it('keeps the cleanup cause before an owner-release failure', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const first = new Error('synthetic cleanup failure');
    const release = new Error('synthetic owner release failure');
    transaction.clearRolledBack.mockRejectedValueOnce(first);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, 'rolledBack') },
      transaction,
      async withRolledBackCleanupAuthority(_journal, use) {
        try { await use(async () => {}); }
        finally { throw release; }
      },
    });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode,
      async stopBackend() {}, async validateActiveProfile() {},
    })).rejects.toMatchObject({ cause: { errors: [first, release] } });
  });

  it('seals a late rolled-back cleanup callback after its owner has returned', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    let lateUse: Parameters<ProfileRestoreRolledBackCleanup>[1] | undefined;
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, 'rolledBack') },
      transaction,
      async withRolledBackCleanupAuthority(_journal, use) { lateUse = use; },
    });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode,
      async stopBackend() {}, async validateActiveProfile() {},
    })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    if (lateUse === undefined) throw new Error('missing cleanup callback');
    const invokeLate = lateUse;
    expect(() => invokeLate(async () => {})).toThrow('PROFILE_RESTORE_DECISION_INVALID');
    expect(transaction.clearRolledBack).not.toHaveBeenCalled();
  });

  it('joins started cleanup before shutdown when the owner returns early', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    let releaseGuard!: () => void;
    let signalGuard!: () => void;
    const guardEntered = new Promise<void>(resolve => { signalGuard = resolve; });
    const guardPending = new Promise<void>(resolve => { releaseGuard = resolve; });
    let stopped = false;
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, 'rolledBack') },
      transaction,
      async withRolledBackCleanupAuthority(_journal, use) {
        void use(async () => { signalGuard(); await guardPending; }).catch(() => {});
      },
    });
    const mode = await recovery.prepareBeforeBackend();
    const result = recovery.validateAfterBackend({ mode,
      async stopBackend() { stopped = true; }, async validateActiveProfile() {},
    });
    const assertion = expect(result).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    await guardEntered;
    expect(stopped).toBe(false);
    releaseGuard();
    await assertion;
    expect(stopped).toBe(true);
    expect(transaction.clearRolledBack).not.toHaveBeenCalled();
  });

  it.each(['unused', 'guardFailure', 'cleanupFailure', 'releaseFailure'] as const)(
    'does not report rolled-back startup ready after %s', async failure => {
      const operationId = randomUUID();
      const selected = createJournal(operationId, 'rolledBack');
      const transaction = createTransaction(operationId);
      const first = new Error('synthetic cleanup authority failure');
      const stopFailure = new Error('synthetic shutdown failure');
      transaction.clearRolledBack.mockImplementation(async (_journal, assertAuthority) => {
        await assertAuthority?.();
        if (failure === 'cleanupFailure') throw first;
      });
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: { peek: unexpectedJournalPeek, read: async () => selected }, transaction,
        async withRolledBackCleanupAuthority(journal, use) {
          expect(journal).toEqual(selected);
          if (failure === 'unused') return;
          await use(async () => { if (failure === 'guardFailure') throw first; });
          if (failure === 'releaseFailure') throw first;
        },
      });
      const mode = await recovery.prepareBeforeBackend();
      const result = recovery.validateAfterBackend({ mode,
        async validateActiveProfile() {},
        async stopBackend() { throw stopFailure; },
      });
      if (failure === 'unused') {
        await expect(result).rejects.toMatchObject({ cause: { errors: [
          expect.objectContaining({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED' }), stopFailure,
        ] } });
      } else {
        await expect(result).rejects.toMatchObject({ cause: { errors: [first, stopFailure] } });
      }
      if (failure === 'unused' || failure === 'guardFailure') expect(transaction.clearRolledBack).not.toHaveBeenCalled();
      expect(transaction.rollback).not.toHaveBeenCalled();
      expect(transaction.commitAcceptance).not.toHaveBeenCalled();
    },
  );

  it('rejects reuse of the rolled-back cleanup callback without repeating mutation', async () => {
    const operationId = randomUUID();
    const selected = createJournal(operationId, 'rolledBack');
    const transaction = createTransaction(operationId);
    const stopBackend = vi.fn(async () => {});
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => selected }, transaction,
      async withRolledBackCleanupAuthority(_journal, use) {
        await use(async () => {});
        await use(async () => {});
      },
    });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode, stopBackend,
      async validateActiveProfile() {},
    })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(transaction.clearRolledBack).toHaveBeenCalledOnce();
    expect(stopBackend).toHaveBeenCalledOnce();
  });

  it.each(['validationFailure', 'deferredDecision'] as const)(
    'denies post-backend rollback without fresh authority after %s', async stage => {
      const operationId = randomUUID();
      const transaction = createTransaction(operationId);
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, 'validationStarting') },
        transaction,
      });
      const mode = await recovery.prepareBeforeBackend();
      const stopBackend = vi.fn(async () => {});
      if (stage === 'validationFailure') {
        await expect(recovery.validateAfterBackend({ mode, stopBackend,
          async validateActiveProfile() { throw new Error('PROFILE_SCHEMA_UNSUPPORTED'); },
        })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
        expect(stopBackend).toHaveBeenCalledOnce();
      } else {
        await recovery.validateAfterBackend({ mode, stopBackend, deferRestoredProfileAcceptance: true,
          validateActiveProfile: vi.fn(async () => {}) });
        await expect(recovery.rollbackValidatedRestoredProfile()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      }
      expect(transaction.rollback).not.toHaveBeenCalled();
      expect(transaction.clearRolledBack).not.toHaveBeenCalled();
    },
  );

  it.each(['validationFailure', 'deferredDecision'] as const)(
    'uses fresh original rollback authority without resetting recovery after %s', async stage => {
      const operationId = randomUUID();
      const selected = { ...createJournal(operationId, 'validationStarting'), revision: 17 };
      const transaction = createTransaction(operationId);
      transaction.advanceToValidation.mockResolvedValueOnce(selected);
      const events: string[] = [];
      const admission: ProfileRestoreColdRollbackAdmission = {
        kind: 'rollback', journal: selected, assertCurrent: vi.fn(async () => {}),
        assertContent: vi.fn(async () => {}), beforeStagingMove: vi.fn(async () => {}),
      };
      const rollback = vi.fn<ProfileRestoreActivationTransaction['rollback']>(async journal => {
        events.push('rollback');
        return { ...journal!, phase: 'rolledBack', revision: journal!.revision + 2 };
      });
      const read = vi.fn(async () => selected);
      const withRollbackAuthority = vi.fn(async (journal: Readonly<ProfileRestoreActivationJournal>,
        use: (authority: ProfileRestoreColdRollbackAdmission) => Promise<void>) => {
        events.push('authority'); expect(journal).toEqual(selected); await use(admission);
      });
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read },
        transaction: { ...transaction, rollback }, withRollbackAuthority });
      const mode = await recovery.prepareBeforeBackend();
      const stopBackend = vi.fn(async () => { events.push('stop'); });
      if (stage === 'validationFailure') {
        await expect(recovery.validateAfterBackend({ mode, stopBackend,
          async validateActiveProfile() { throw new Error('PROFILE_SCHEMA_UNSUPPORTED'); },
        })).resolves.toBe('relaunchRequired');
        expect(events).toEqual(['stop', 'authority', 'rollback']);
      } else {
        await recovery.validateAfterBackend({ mode, stopBackend, deferRestoredProfileAcceptance: true,
          validateActiveProfile: vi.fn(async () => {}) });
        await recovery.rollbackValidatedRestoredProfile();
        expect(events).toEqual(['authority', 'rollback']);
        await expect(recovery.rollbackValidatedRestoredProfile()).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
      }
      expect(read).toHaveBeenCalledOnce();
      expect(withRollbackAuthority).toHaveBeenCalledOnce();
      expect(rollback).toHaveBeenCalledExactlyOnceWith(selected, admission.assertCurrent, {
        assertContent: admission.assertContent, beforeStagingMove: admission.beforeStagingMove,
      });
      expect(recovery.readAcceptanceState()).toBe('notStarted');
    },
  );

  it('keeps the validation failure first when fresh rollback admission fails', async () => {
    const operationId = randomUUID(); const transaction = createTransaction(operationId);
    const first = new Error('PROFILE_SCHEMA_UNSUPPORTED'); const rejection = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    const withRollbackAuthority = vi.fn(async () => { throw rejection; });
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek,
      read: async () => createJournal(operationId, 'validationStarting') }, transaction, withRollbackAuthority });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode, stopBackend: vi.fn(async () => {}),
      async validateActiveProfile() { throw first; },
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: { errors: [first, rejection] } });
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(transaction.clearRolledBack).not.toHaveBeenCalled();
  });

  it('does not acquire rollback authority after backend stop fails', async () => {
    const operationId = randomUUID(); const transaction = createTransaction(operationId);
    const first = new Error('PROFILE_SCHEMA_UNSUPPORTED'); const stop = new Error('synthetic stop failure');
    const withRollbackAuthority = vi.fn(async () => {});
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek,
      read: async () => createJournal(operationId, 'validationStarting') }, transaction, withRollbackAuthority });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode, async stopBackend() { throw stop; },
      async validateActiveProfile() { throw first; },
    })).rejects.toMatchObject({ cause: { errors: [first, stop] } });
    expect(withRollbackAuthority).not.toHaveBeenCalled(); expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('defers an accepted cold journal until fresh backend validation', async () => {
    const operationId = randomUUID();
    const journal = createJournal(operationId, 'accepted');
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => journal }, transaction,
    });
    await expect(recovery.prepareBeforeBackend()).resolves.toBe('validateAcceptedProfile');
    expect(transaction.commitAcceptance).not.toHaveBeenCalled();
  });

  it.each(['rollbackStarting', 'rolledBack'] as const)(
    'retains %s evidence instead of authorizing creation of an absent original database', async phase => {
      const operationId = randomUUID();
      const journal = { ...createJournal(operationId, phase), hadActiveDatabase: false };
      const transaction = createTransaction(operationId);
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: { peek: unexpectedJournalPeek, read: async () => journal }, transaction,
      });
      await expect(recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(transaction.rollback).not.toHaveBeenCalled();
      expect(transaction.clearRolledBack).not.toHaveBeenCalled();
      expect(transaction.advanceToValidation).not.toHaveBeenCalled();
    },
  );

  it('binds accepted cold recovery to the selected journal without repairing read', async () => {
    const operationId = randomUUID();
    const selected = createJournal(operationId, 'accepted');
    const read = vi.fn(async (_expected?: Readonly<ProfileRestoreActivationJournal>) => selected);
    const transaction = createTransaction(operationId);
    const peek = vi.fn(async () => selected);
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek, read }, transaction });
    await expect(recovery.prepareBeforeBackend(undefined, selected)).resolves.toBe('validateAcceptedProfile');
    expect(peek).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(recovery.readAcceptanceState()).toBe('committed');
    expect(transaction.clearAccepted).not.toHaveBeenCalled();
  });

  it('validates accepted content before cleanup without publishing acceptance again', async () => {
    const operationId = randomUUID();
    const selected = createJournal(operationId, 'accepted');
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read: async () => selected }, transaction });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode, stopBackend: vi.fn(), async validateActiveProfile() {
      expect(transaction.clearAccepted).not.toHaveBeenCalled();
    } })).resolves.toBe('ready');
    expect(transaction.commitAcceptance).not.toHaveBeenCalled();
    expect(transaction.clearAccepted).toHaveBeenCalledExactlyOnceWith(selected);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('retains committed content when cold backend validation fails', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const primary = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek,
      read: async () => createJournal(operationId, 'accepted') }, transaction });
    const mode = await recovery.prepareBeforeBackend();
    const stopBackend = vi.fn(async () => {});
    await expect(recovery.validateAfterBackend({ mode, stopBackend, async validateActiveProfile() { throw primary; } }))
      .rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary });
    expect(stopBackend).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(transaction.clearAccepted).not.toHaveBeenCalled();
    expect(recovery.readAcceptanceState()).toBe('committed');
  });

  it.each([false, true])('never rolls back committed acceptance after cleanup failure (deferred: %s)', async deferred => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const primary = new Error('synthetic terminal cleanup failed');
    transaction.clearAccepted.mockRejectedValueOnce(primary);
    const events: ProfileRecoveryOperationalEvent[] = [];
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek,
      read: async () => createJournal(operationId, 'validationStarting') }, transaction,
      observer: { observe: event => events.push(event) } });
    const mode = await recovery.prepareBeforeBackend();
    const stopBackend = vi.fn(async () => {});
    const validation = recovery.validateAfterBackend({ mode, deferRestoredProfileAcceptance: deferred,
      stopBackend, validateActiveProfile: vi.fn(async () => {}) });
    if (deferred) {
      await expect(validation).resolves.toBe('restoredProfileReady');
      await expect(recovery.acceptValidatedRestoredProfile({ assertTargetCanAccept() {} })).rejects.toBe(primary);
    } else {
      await expect(validation).rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary });
    }
    expect(recovery.readAcceptanceState()).toBe('committed');
    await expect(recovery.rollbackValidatedRestoredProfile()).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(stopBackend).toHaveBeenCalledTimes(deferred ? 0 : 1);
    expect(events.some(event => event.eventName === 'restore.validationCompleted')).toBe(true);
    expect(events.some(event => event.eventName === 'restore.validationFailed')).toBe(false);
  });

  it('blocks rollback and repeated publication when accepted readback is uncertain', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const primary = new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    transaction.commitAcceptance.mockRejectedValueOnce(primary);
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek,
      read: async () => createJournal(operationId, 'validationStarting') }, transaction });
    const mode = await recovery.prepareBeforeBackend();
    await recovery.validateAfterBackend({ mode, deferRestoredProfileAcceptance: true,
      stopBackend: vi.fn(), validateActiveProfile: vi.fn(async () => {}) });
    await expect(recovery.acceptValidatedRestoredProfile({ assertTargetCanAccept() {} })).rejects.toBe(primary);
    expect(recovery.readAcceptanceState()).toBe('unverified');
    await expect(recovery.rollbackValidatedRestoredProfile()).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
    await expect(recovery.acceptValidatedRestoredProfile({ assertTargetCanAccept() {} })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(transaction.commitAcceptance).toHaveBeenCalledOnce();
    expect(transaction.clearAccepted).not.toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('keeps valid forward restoration into an originally absent database separate from rollback absence', async () => {
    const operationId = randomUUID();
    const journal = { ...createJournal(operationId, 'validationStarting'), hadActiveDatabase: false };
    const transaction = createTransaction(operationId);
    transaction.advanceToValidation.mockResolvedValueOnce(journal);
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read: async () => journal }, transaction });
    const mode = await recovery.prepareBeforeBackend();
    await expect(recovery.validateAfterBackend({ mode, stopBackend: vi.fn(), validateActiveProfile: vi.fn(async () => {}) })).resolves.toBe('ready');
    expect(recovery.readAcceptanceState()).toBe('committed');
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it.each(['forwardActivation', 'restoredValidation'] as const)(
    'retains the first %s failure when rollback confirms the original database was absent', async stage => {
      const operationId = randomUUID();
      const selected = { ...createJournal(operationId, 'validationStarting'), hadActiveDatabase: false };
      const primary = new Error('PROFILE_SCHEMA_UNSUPPORTED');
      const transaction = createTransaction(operationId);
      transaction.advanceToValidation.mockResolvedValueOnce(selected);
      transaction.rollback.mockResolvedValueOnce({ ...selected, phase: 'rolledBack',
        revision: selected.revision + (stage === 'restoredValidation' ? 2 : 1) });
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: { peek: async () => selected, read: async () => selected }, transaction,
        withRollbackAuthority: withTestRollbackAuthority,
      });
      const stopBackend = vi.fn(async () => {});
      if (stage === 'forwardActivation') {
        transaction.advanceToValidation.mockReset().mockRejectedValueOnce(primary);
        await expect(recovery.prepareBeforeBackend()).rejects.toMatchObject({
          message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary,
        });
      } else {
        const mode = await recovery.prepareBeforeBackend();
        await expect(recovery.validateAfterBackend({ mode, stopBackend,
          async validateActiveProfile() { throw primary; },
        })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary });
      }
      expect(transaction.rollback).toHaveBeenCalledOnce();
      expect(transaction.commitAcceptance).not.toHaveBeenCalled();
      expect(transaction.clearAccepted).not.toHaveBeenCalled();
      expect(transaction.clearRolledBack).not.toHaveBeenCalled();
      expect(stopBackend).toHaveBeenCalledTimes(stage === 'restoredValidation' ? 1 : 0);
    },
  );

  it.each(['commitAcceptance', 'clearRolledBack', 'rollback'] as const)(
    'passes the frozen startup decision to terminal %s instead of reselecting an operation', async action => {
      const operationId = randomUUID();
      const selected = createJournal(operationId, action === 'clearRolledBack' ? 'rolledBack' : 'validationStarting');
      const expected = { ...selected };
      const transaction = createTransaction(operationId);
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read: async () => selected },
        transaction, withRollbackAuthority: withTestRollbackAuthority });
      const mode = await recovery.prepareBeforeBackend();
      selected.operationId = randomUUID();
      selected.revision = 99;
      await recovery.validateAfterBackend({ mode, stopBackend: vi.fn(async () => {}),
        async validateActiveProfile() { if (action === 'rollback') throw new Error('synthetic validation failed'); },
      });
      if (action === 'rollback') expect(transaction.rollback).toHaveBeenCalledExactlyOnceWith(expected,
        expect.any(Function), { assertContent: expect.any(Function), beforeStagingMove: expect.any(Function) });
      else expect(transaction[action]).toHaveBeenCalledExactlyOnceWith(expected);
      expect(Object.isFrozen(transaction[action].mock.calls[0]![0])).toBe(true);
    },
  );

  it('keeps the actual forward journal revision for the later acceptance decision', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const committed = { ...createJournal(operationId, 'validationStarting'), revision: 17 };
    transaction.advanceToValidation.mockResolvedValueOnce(committed);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, 'prepared') }, transaction,
    });
    const mode = await recovery.prepareBeforeBackend();
    await recovery.validateAfterBackend({ mode, stopBackend: vi.fn(async () => {}), validateActiveProfile: vi.fn(async () => {}) });
    expect(transaction.commitAcceptance).toHaveBeenCalledExactlyOnceWith(committed);
  });

  it('passes the selected cold journal to repairing read and retains a readback failure', async () => {
    const operationId = randomUUID();
    const journal = createJournal(operationId, 'prepared');
    const transaction = createTransaction(operationId);
    const primary = new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    const read = vi.fn(async () => { throw primary; });
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read }, transaction });
    await expect(recovery.prepareBeforeBackend({ journal, assertCurrent: vi.fn(async () => {}), assertContent: vi.fn(async () => {}) }))
      .rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary });
    expect(read).toHaveBeenCalledExactlyOnceWith(journal, expect.any(Function));
    expect(transaction.assertForwardRecoveryState).not.toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it.each(['stateCheck', 'forwardFailure', 'forwardSuccess'] as const)(
    'does not authorize continuation or rollback after losing cold ownership during %s', async stage => {
      const operationId = randomUUID();
      const journal = createJournal(operationId, 'prepared');
      const transaction = createTransaction(operationId);
      const primary = new Error('synthetic forward failure');
      const ownership = new Error('synthetic ownership lost');
      let current = true;
      if (stage === 'stateCheck') transaction.assertForwardRecoveryState.mockImplementation(async () => { current = false; });
      else transaction.advanceToValidation.mockImplementation(async () => {
        current = false;
        if (stage === 'forwardFailure') throw primary;
        return createJournal(operationId, 'validationStarting');
      });
      const events: ProfileRecoveryOperationalEvent[] = [];
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read: async () => journal },
        transaction, observer: { observe: event => events.push(event) } });
      await expect(recovery.prepareBeforeBackend({ journal, assertContent: vi.fn(async () => {}), async assertCurrent() {
        if (!current) throw ownership;
      } })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(transaction.rollback).not.toHaveBeenCalled();
      expect(transaction.commitAcceptance).not.toHaveBeenCalled();
      if (stage === 'stateCheck') expect(transaction.advanceToValidation).not.toHaveBeenCalled();
      expect(events).toEqual([expect.objectContaining({ eventName: 'restore.recoveryRequired' })]);
      expect(JSON.stringify(events)).not.toContain(ownership.message);
    },
  );

  it.each(['accepted', 'rollbackStarting', 'rolledBack', 'failedSafe'] as const)(
    'rejects a forward admission for terminal %s before repairing read', async phase => {
      const operationId = randomUUID();
      const transaction = createTransaction(operationId);
      const read = vi.fn(async () => createJournal(operationId, phase));
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read }, transaction });
      await expect(recovery.prepareBeforeBackend({ journal: createJournal(operationId, phase),
        assertCurrent: vi.fn(async () => {}), assertContent: vi.fn(async () => {}) })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(read).not.toHaveBeenCalled();
      expect(transaction.commitAcceptance).not.toHaveBeenCalled();
      expect(transaction.rollback).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])('pins the forward write context and its absence before awaits (%s)', async scoped => {
    const id = randomUUID(); const journal = createJournal(id, 'prepared');
    const transaction = createTransaction(id);
    const foreign = vi.fn(() => { throw new Error('SYNTHETIC_FOREIGN_CALLBACK'); });
    const readOwner = vi.fn(async () => {}); const mutation = vi.fn(() => {});
    const content = vi.fn(async (_journal: Readonly<ProfileRestoreActivationJournal>) => {});
    const context = { assertReadOwnership: readOwner, assertMutationCurrent: mutation };
    const admission = { journal, assertContent: content, async assertCurrent() {
      Object.assign(context, { assertReadOwnership: foreign, assertMutationCurrent: foreign });
      if (scoped) Object.assign(admission, { assertCurrent: foreign, assertContent: foreign,
        journal: { ...journal, revision: 99 } });
      Object.assign(admission, { journalWriteContext: context });
    }, ...(scoped ? { journalWriteContext: context } : {}) };
    const read = vi.fn(async (_expected?: Readonly<ProfileRestoreActivationJournal>, assertContent?: () => Promise<void>, guard?: () => void) => {
      await assertContent?.(); guard?.(); return journal;
    });
    transaction.advanceToValidation.mockImplementation(async (...args) => {
      expect(args).toHaveLength(scoped ? 4 : 3);
      const [selected, assertCurrent, assertContent, writeContext] = args;
      expect(selected).toEqual(journal); await assertCurrent!(); await assertContent!(journal);
      if (scoped) { await writeContext!.assertReadOwnership(); writeContext!.assertMutationCurrent(); }
      else expect(writeContext).toBeUndefined();
      return createJournal(id, 'validationStarting');
    });
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read }, transaction });
    await expect(recovery.prepareBeforeBackend(admission)).resolves.toBe('validateRestoredProfile');
    expect(read.mock.calls[0]).toHaveLength(scoped ? 3 : 2);
    expect(readOwner).toHaveBeenCalledTimes(scoped ? 1 : 0);
    expect(mutation).toHaveBeenCalledTimes(scoped ? 2 : 0);
    expect(foreign).not.toHaveBeenCalled();
  });

  it.each(['null', 'missingRead', 'missingMutation', 'missingContent', 'missingOwner', 'rollback'] as const)(
    'rejects incomplete or misapplied forward write context %s before repairing reads', async variant => {
      const id = randomUUID(); const journal = createJournal(id, variant === 'rollback' ? 'rolledBack' : 'prepared');
      const transaction = createTransaction(id); const read = vi.fn(async () => journal);
      const context = { async assertReadOwnership() {}, assertMutationCurrent() {} };
      const admission = { journal, async assertCurrent() {}, async assertContent() {}, journalWriteContext: context };
      if (variant === 'null') Object.assign(admission, { journalWriteContext: null });
      if (variant === 'missingRead') Object.assign(context, { assertReadOwnership: undefined });
      if (variant === 'missingMutation') Object.assign(context, { assertMutationCurrent: undefined });
      if (variant === 'missingContent') Object.assign(admission, { assertContent: undefined });
      if (variant === 'missingOwner') Object.assign(admission, { assertCurrent: undefined });
      if (variant === 'rollback') Object.assign(admission, { kind: 'rollback' });
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read }, transaction });
      await expect(recovery.prepareBeforeBackend(admission)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(read).not.toHaveBeenCalled(); expect(transaction.advanceToValidation).not.toHaveBeenCalled();
    },
  );

  it.each(['pending', 'rejected', 'resolved'] as const)('rejects a %s forward repair guard', async result => {
    const id = randomUUID(); const journal = createJournal(id, 'prepared');
    const transaction = createTransaction(id); let repaired = false;
    const recovery = new ProfileRestoreStartupRecovery({ transaction, journalStore: { peek: unexpectedJournalPeek,
      async read(_expected, content, guard) { await content!(); guard!(); repaired = true; return journal; },
    } });
    await expect(recovery.prepareBeforeBackend({ journal, async assertCurrent() {}, async assertContent() {},
      journalWriteContext: { async assertReadOwnership() {}, assertMutationCurrent: () => result === 'pending'
        ? new Promise<void>(() => {}) : result === 'rejected' ? Promise.reject(new Error('SYNTHETIC_ASYNC_GUARD')) : Promise.resolve() },
    })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(repaired).toBe(false); expect(transaction.advanceToValidation).not.toHaveBeenCalled();
  });

  it('passes a frozen checked journal into forward continuation', async () => {
    const operationId = randomUUID();
    const original = createJournal(operationId, 'currentDatabaseMoved');
    const transaction = createTransaction(operationId);
    const inspected: unknown[] = [];
    transaction.assertForwardRecoveryState = vi.fn(async journal => {
      inspected.push(journal);
      expect(Object.isFrozen(journal)).toBe(true);
      original.revision = 99;
    });
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek: unexpectedJournalPeek, read: async () => original }, transaction });
    await expect(recovery.prepareBeforeBackend()).resolves.toBe('validateRestoredProfile');
    expect(transaction.advanceToValidation).toHaveBeenCalledExactlyOnceWith(inspected[0]);
    expect(inspected[0]).toMatchObject({ revision: 1 });
  });

  it.each(['accepted', 'rollbackStarting', 'rolledBack', 'failedSafe'] as const)(
    'does not infer forward inspection authority from terminal %s', async phase => {
      const operationId = randomUUID();
      const transaction = createTransaction(operationId);
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, phase) }, transaction,
      });
      if (phase === 'failedSafe') {
        await expect(recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      } else {
        await expect(recovery.prepareBeforeBackend()).resolves.toBe(
          phase === 'accepted' ? 'validateAcceptedProfile' : 'validateRolledBackProfile');
      }
      expect(transaction.assertForwardRecoveryState).not.toHaveBeenCalled();
      expect(transaction.advanceToValidation).not.toHaveBeenCalled();
    },
  );

  it('keeps the first state error without attempting forward mutation or rollback', async () => {
    const operationId = randomUUID();
    const journal = createJournal(operationId, 'currentDatabaseMoved');
    const original = new Error('synthetic private slot detail', {
      cause: new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID'),
    });
    const events: ProfileRecoveryOperationalEvent[] = [];
    const transaction = createTransaction(operationId);
    transaction.assertForwardRecoveryState.mockRejectedValueOnce(original);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek, read: async () => journal },
      observer: { observe: event => events.push(event) }, transaction,
    });

    await expect(recovery.prepareBeforeBackend()).rejects.toMatchObject({
      message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: original,
    });
    expect(transaction.assertForwardRecoveryState).toHaveBeenCalledExactlyOnceWith(journal);
    expect(transaction.advanceToValidation).not.toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(transaction.commitAcceptance).not.toHaveBeenCalled();
    expect(events).toEqual([{
      correlationId: operationId, errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      eventName: 'restore.recoveryRequired', retryable: false, sideEffectState: 'unknown',
      stage: 'startupRollback',
    }]);
    expect(JSON.stringify(events)).not.toContain(original.message);
  });

  for (const mode of ['validateRestoredProfile', 'validateRolledBackProfile'] as const) {
    it.each(profileInspectionFailureCauses)(`keeps wrapped %s before recovery in ${mode}`, async (cause) => {
      const operationId = randomUUID();
      const events: ProfileRecoveryOperationalEvent[] = [];
      const transaction = createTransaction(operationId);
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId,
          mode === 'validateRestoredProfile' ? 'validationStarting' : 'rolledBack') },
        observer: { observe: (event) => events.push(event) },
        transaction,
        withRollbackAuthority: withTestRollbackAuthority,
      });
      const original = new Error('synthetic private startup detail', { cause: new Error(cause) });
      const stopBackend = vi.fn();
      await expect(recovery.prepareBeforeBackend()).resolves.toBe(mode);
      const result = recovery.validateAfterBackend({
        mode, stopBackend, validateActiveProfile: async () => { throw original; },
      });
      if (mode === 'validateRestoredProfile') {
        await expect(result).resolves.toBe('relaunchRequired');
        expect(transaction.rollback).toHaveBeenCalledOnce();
      } else {
        await expect(result).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
        expect(transaction.rollback).not.toHaveBeenCalled();
        expect(events.at(-1)).toMatchObject({
          eventName: 'restore.recoveryRequired',
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          retryable: false, sideEffectState: 'unknown',
        });
      }
      expect(events[0]).toMatchObject({
        errorCode: cause, eventName: 'restore.validationFailed',
        retryable: false, sideEffectState: 'unknown',
        stage: mode === 'validateRestoredProfile' ? 'restoredProfile' : 'rolledBackProfile',
      });
      expect(stopBackend).toHaveBeenCalledOnce();
      expect(transaction.commitAcceptance).not.toHaveBeenCalled();
      expect(transaction.clearRolledBack).not.toHaveBeenCalled();
      expect(JSON.stringify(events)).not.toContain(original.message);
    });
  }

  it('finishes an interrupted activation before starting the backend', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'currentDatabaseMoved'),
        ),
      },
      transaction,
    });

    await expect(recovery.prepareBeforeBackend()).resolves.toBe(
      'validateRestoredProfile',
    );
    expect(transaction.advanceToValidation).toHaveBeenCalledTimes(1);
  });

  it('accepts a healthy restored profile only after active validation', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'validationStarting'),
        ),
      },
      observer: { observe: (event) => events.push(event) },
      transaction,
    });

    await expect(recovery.prepareBeforeBackend()).resolves.toBe(
      'validateRestoredProfile',
    );
    await expect(
      recovery.validateAfterBackend({
        mode: 'validateRestoredProfile',
        stopBackend: vi.fn(),
        validateActiveProfile: vi.fn(),
      }),
    ).resolves.toBe('ready');
    expect(transaction.commitAcceptance).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.validationCompleted',
        stage: 'restoredProfile',
      }),
    ]);
  });

  it('defers restored profile acceptance until the caller accepts the validated target', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'validationStarting'),
        ),
      },
      transaction,
    });

    await expect(recovery.prepareBeforeBackend()).resolves.toBe(
      'validateRestoredProfile',
    );
    await expect(
      recovery.validateAfterBackend({
        deferRestoredProfileAcceptance: true,
        mode: 'validateRestoredProfile',
        stopBackend: vi.fn(),
        validateActiveProfile: vi.fn(),
      }),
    ).resolves.toBe('restoredProfileReady');
    expect(transaction.commitAcceptance).not.toHaveBeenCalled();

    await expect(
      recovery.acceptValidatedRestoredProfile({
        assertTargetCanAccept: vi.fn(),
      }),
    ).resolves.toBeUndefined();
    expect(transaction.commitAcceptance).toHaveBeenCalledTimes(1);
    await expect(
      recovery.acceptValidatedRestoredProfile({
        assertTargetCanAccept: vi.fn(),
      }),
    ).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
  });

  it('keeps rollback authority when the active target rejects restored lineage', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'validationStarting'),
        ),
      },
      transaction,
      withRollbackAuthority: withTestRollbackAuthority,
    });

    await recovery.prepareBeforeBackend();
    await recovery.validateAfterBackend({
      deferRestoredProfileAcceptance: true,
      mode: 'validateRestoredProfile',
      stopBackend: vi.fn(),
      validateActiveProfile: vi.fn(),
    });

    await expect(
      recovery.acceptValidatedRestoredProfile({
        assertTargetCanAccept: vi.fn(() => {
          throw new Error('WORKSPACE_SWITCH_INVALID');
        }),
      }),
    ).rejects.toThrow('WORKSPACE_SWITCH_INVALID');
    expect(transaction.commitAcceptance).not.toHaveBeenCalled();

    await expect(
      recovery.rollbackValidatedRestoredProfile(),
    ).resolves.toBeUndefined();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('can roll back a healthy restored profile while acceptance is deferred', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'validationStarting'),
        ),
      },
      transaction,
      withRollbackAuthority: withTestRollbackAuthority,
    });

    await recovery.prepareBeforeBackend();
    await recovery.validateAfterBackend({
      deferRestoredProfileAcceptance: true,
      mode: 'validateRestoredProfile',
      stopBackend: vi.fn(),
      validateActiveProfile: vi.fn(),
    });

    await expect(
      recovery.rollbackValidatedRestoredProfile(),
    ).resolves.toBeUndefined();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commitAcceptance).not.toHaveBeenCalled();
  });

  it('rolls back an unhealthy restored profile and requests a fresh process', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const transaction = createTransaction(operationId);
    const stopBackend = vi.fn();
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'validationStarting'),
        ),
      },
      observer: { observe: (event) => events.push(event) },
      transaction,
      withRollbackAuthority: withTestRollbackAuthority,
    });

    await expect(recovery.prepareBeforeBackend()).resolves.toBe(
      'validateRestoredProfile',
    );
    await expect(
      recovery.validateAfterBackend({
        mode: 'validateRestoredProfile',
        stopBackend,
        validateActiveProfile: vi.fn(async () => {
          throw new Error('invalid');
        }),
      }),
    ).resolves.toBe('relaunchRequired');
    expect(stopBackend).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.validationFailed',
      }),
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.rollbackStarted',
        stage: 'startupRollback',
      }),
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.rollbackCompleted',
        stage: 'startupRollback',
      }),
    ]);
  });

  it('fails safe when the rolled-back profile is not healthy', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'rolledBack'),
        ),
      },
      observer: { observe: (event) => events.push(event) },
      transaction,
    });

    await expect(recovery.prepareBeforeBackend()).resolves.toBe(
      'validateRolledBackProfile',
    );
    await expect(
      recovery.validateAfterBackend({
        mode: 'validateRolledBackProfile',
        stopBackend: vi.fn(),
        validateActiveProfile: vi.fn(async () => {
          throw new Error('invalid');
        }),
      }),
    ).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(transaction.clearRolledBack).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.validationFailed',
        stage: 'rolledBackProfile',
      }),
      {
        correlationId: operationId,
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        eventName: 'restore.recoveryRequired',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'rolledBackProfile',
      },
    ]);
  });

  it.each(['validateRestoredProfile', 'validateRolledBackProfile'] as const)(
    'does not change profile files when stopping the backend fails during %s',
    async (mode) => {
      const operationId = randomUUID();
      const events: ProfileRecoveryOperationalEvent[] = [];
      const transaction = createTransaction(operationId);
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: { peek: unexpectedJournalPeek,
          read: async () => createJournal(
            operationId,
            mode === 'validateRestoredProfile' ? 'validationStarting' : 'rolledBack',
          ),
        },
        observer: { observe: (event) => events.push(event) },
        transaction,
      });
      await expect(recovery.prepareBeforeBackend()).resolves.toBe(mode);

      await expect(recovery.validateAfterBackend({
        mode,
        async validateActiveProfile() {
          throw new Error('SYNTHETIC_VALIDATION_FAILED');
        },
        async stopBackend() {
          throw new Error('SYNTHETIC_STOP_FAILED');
        },
      })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');

      expect(transaction.commitAcceptance).not.toHaveBeenCalled();
      expect(transaction.rollback).not.toHaveBeenCalled();
      expect(transaction.clearRolledBack).not.toHaveBeenCalled();
      expect(events).toEqual([
        expect.objectContaining({
          eventName: 'restore.validationFailed',
          errorCode: 'SYNTHETIC_VALIDATION_FAILED',
        }),
        expect.objectContaining({
          eventName: 'restore.recoveryRequired',
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        }),
      ]);
    },
  );

  it('reports a failed-safe startup journal before blocking startup', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () => createJournal(operationId, 'failedSafe')),
      },
      observer: { observe: (event) => events.push(event) },
      transaction: createTransaction(operationId),
    });

    await expect(recovery.prepareBeforeBackend()).rejects.toThrow(
      'PROFILE_RESTORE_RECOVERY_REQUIRED',
    );
    expect(events).toEqual([
      {
        correlationId: operationId,
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        eventName: 'restore.recoveryRequired',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'failedSafeJournal',
      },
    ]);
  });

  it('reports recovery required when startup rollback fails', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const transaction = createTransaction(operationId);
    transaction.rollback.mockRejectedValueOnce(new Error('synthetic'));
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: { peek: unexpectedJournalPeek,
        read: vi.fn(async () =>
          createJournal(operationId, 'rollbackStarting'),
        ),
      },
      observer: { observe: (event) => events.push(event) },
      transaction,
    });

    await expect(recovery.prepareBeforeBackend()).rejects.toThrow(
      'PROFILE_RESTORE_RECOVERY_REQUIRED',
    );
    expect(events.map(({ eventName }) => eventName)).toEqual([
      'restore.rollbackStarted',
      'restore.rollbackFailed',
      'restore.recoveryRequired',
    ]);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.recoveryRequired',
        stage: 'startupRollback',
      }),
    );
  });
});

async function unexpectedJournalPeek(): Promise<never> {
  throw new Error('Unexpected interrupted-forward journal selection.');
}

function continuationGate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function validatedRollbackFixture(missingOwner = false) {
  const operationId = randomUUID();
  const clear = vi.fn<ProfileRestoreActivationTransaction['clearRolledBack']>(async () => {});
  const transaction = { ...createTransaction(operationId), clearRolledBack: clear };
  const guard = vi.fn(async () => {}); const syncGuard = vi.fn<() => void>(() => {});
  const report = vi.fn((_cause: unknown) => {}); const stop = vi.fn(async () => {});
  const validateLegacy = vi.fn(async () => {});
  const withCleanup = vi.fn<ProfileRestoreRolledBackCleanup>(async (_journal, use) => { await use(guard, syncGuard); });
  const events: ProfileRecoveryOperationalEvent[] = [];
  const recovery = new ProfileRestoreStartupRecovery({
    journalStore: { peek: unexpectedJournalPeek, read: async () => createJournal(operationId, 'rolledBack') }, transaction,
    observer: { observe: event => { events.push(event); } },
    ...(missingOwner ? {} : { withRolledBackCleanupAuthority: withCleanup }),
  });
  const run = (mode: Parameters<ProfileRestoreStartupRecovery['validateAfterBackend']>[0]['mode'],
    withValidatedRolledBackProfile: ProfileRestoreValidatedRollback) => recovery.validateAfterBackend({
    mode, stopBackend: stop, validateActiveProfile: validateLegacy, withValidatedRolledBackProfile,
  });
  return { recovery, clear, transaction, guard, syncGuard, report, stop, validateLegacy, withCleanup, events, run };
}

const withTestRollbackAuthority: ProfileRestoreRollbackAcceptance = async (journal, use) => {
  await use({ kind: 'rollback', journal, async assertCurrent() {}, async assertContent() {}, async beforeStagingMove() {} });
};

function createTransaction(operationId: string) {
  return {
    commitAcceptance: vi.fn(async (journal: Readonly<ProfileRestoreActivationJournal>) => ({
      ...journal, phase: 'accepted' as const, revision: journal.revision + 1,
    })),
    clearAccepted: vi.fn(),
    assertForwardRecoveryState: vi.fn(async (_journal: Readonly<ReturnType<typeof createJournal>>) => undefined),
    advanceToValidation: vi.fn<ProfileRestoreActivationTransaction['advanceToValidation']>(async () =>
      createJournal(operationId, 'validationStarting'),
    ),
    clearRolledBack: vi.fn(),
    rollback: vi.fn(async (journal?: Readonly<ProfileRestoreActivationJournal>) => journal === undefined
      ? createJournal(operationId, 'rolledBack')
      : { ...journal, phase: 'rolledBack' as const, revision: journal.revision + (journal.phase === 'validationStarting' ? 2 : 1) }),
  };
}

function createJournal(
  operationId: string,
  phase: ProfileRestoreActivationPhase,
): ProfileRestoreActivationJournal {
  return {
    formatVersion: 1 as const,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId,
    phase,
    revision: 1,
  };
}
