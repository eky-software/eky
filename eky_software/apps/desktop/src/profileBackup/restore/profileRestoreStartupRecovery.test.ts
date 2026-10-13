import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import { profileInspectionFailureCauses } from '../../runtime/profileInspectionFailure.js';
import type { ProfileRestoreActivationJournal, ProfileRestoreActivationPhase } from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import type { ProfileRestoreColdRollbackAdmission, ProfileRestoreRollbackAcceptance } from './profileRestoreStartupRecovery.js';

describe('profile restore startup recovery', () => {
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
    advanceToValidation: vi.fn(async () =>
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
