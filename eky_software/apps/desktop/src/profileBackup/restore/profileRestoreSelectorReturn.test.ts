import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import { ProfileRestoreStartupRecovery, type ProfileRestoreColdRollbackAdmission } from './profileRestoreStartupRecovery.js';

describe('rolled-back selector return', () => {
  it('rejects completion while earlier live validation is still pending', async () => {
    const f = await fixture(); let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const validation = f.recovery.validateAfterBackend({ mode: 'validateRolledBackProfile', async stopBackend() {},
      async validateActiveProfile() { entered(); await new Promise<void>(resolve => { release = resolve; }); } });
    const settled = validation.then(() => undefined, () => undefined);
    try {
      await started;
      await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission))
        .rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
      expect(f.clear).not.toHaveBeenCalled(); expect(f.assertContent).not.toHaveBeenCalled();
    } finally { release(); await settled; }
  });

  it('requires fresh original content at terminal removal without accepting business use', async () => {
    const f = await fixture();
    await f.recovery.completeRolledBackBeforeSelectorReturn(f.admission);
    expect(f.assertContent).toHaveBeenCalledTimes(2);
    expect(f.clear).toHaveBeenCalledExactlyOnceWith(f.selected, expect.any(Function), expect.any(Function));
    expect(f.recovery.readAcceptanceState()).toBe('notStarted');
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.peek).toHaveBeenCalledOnce();
    expect(f.transaction.advanceToValidation).not.toHaveBeenCalled();
    expect(f.transaction.rollback).not.toHaveBeenCalled();
    expect(f.transaction.commitAcceptance).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    await expect(f.recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
    await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission))
      .rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
  });

  it.each(['operation', 'revision', 'presence', 'phase'] as const)(
    'rejects a mismatched %s admission without removing evidence', async mismatch => {
      const f = await fixture();
      const journal = { ...f.selected,
        ...(mismatch === 'operation' ? { operationId: randomUUID() } : {}),
        ...(mismatch === 'revision' ? { revision: f.selected.revision + 1 } : {}),
        ...(mismatch === 'presence' ? { hadActiveDatabase: false } : {}),
        ...(mismatch === 'phase' ? { phase: 'accepted' as const } : {}),
      };
      await expect(f.recovery.completeRolledBackBeforeSelectorReturn({ ...f.admission, journal }))
        .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(f.clear).not.toHaveBeenCalled(); expect(f.stored()).toEqual(f.selected);
    },
  );

  it.each(['authority', 'content', 'cleanup', 'readback'] as const)(
    'retains the original %s error and forbids retrying the same owner', async stage => {
      const f = await fixture(); const first = new Error(`synthetic ${stage} failure`);
      if (stage === 'authority') f.assertCurrent.mockRejectedValueOnce(first);
      if (stage === 'content') f.assertContent.mockRejectedValueOnce(first);
      if (stage === 'cleanup') f.clear.mockRejectedValueOnce(first);
      if (stage === 'readback') f.peek.mockRejectedValueOnce(first);
      await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission)).rejects.toMatchObject({ cause: first });
      if (stage !== 'readback') expect(f.stored()).toEqual(f.selected);
      await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission))
        .rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
      await expect(f.recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
      expect(f.observe).toHaveBeenCalledWith(expect.objectContaining({
        eventName: 'restore.recoveryRequired', stage: 'rolledBackProfile',
      }));
    },
  );

  it('rejects original bytes changed at the removal guard', async () => {
    const f = await fixture(); const first = new Error('synthetic original bytes changed');
    f.assertContent.mockResolvedValueOnce(undefined).mockRejectedValue(first);
    await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission)).rejects.toMatchObject({ cause: first });
    expect(f.clear).toHaveBeenCalledOnce(); expect(f.stored()).toEqual(f.selected);
    expect(f.peek).not.toHaveBeenCalled();
  });

  it('does not accept a leftover or replaced journal after a reported clear', async () => {
    const f = await fixture(); f.clear.mockResolvedValueOnce(undefined);
    await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.stored()).toEqual(f.selected);
  });

  it('requires the named rollback-root handoff even if cleanup might find no root', async () => {
    const f = await fixture();
    const { beforeRollbackRootRemoval: _omitted, ...admission } = f.admission;
    await expect(f.recovery.completeRolledBackBeforeSelectorReturn(admission))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.clear).not.toHaveBeenCalled(); expect(f.stored()).toEqual(f.selected);
  });

  it('checks physical authority again after the absent-journal readback', async () => {
    const f = await fixture(); const first = new Error('synthetic reservation lost');
    f.peek.mockImplementationOnce(async () => { f.assertCurrent.mockRejectedValue(first); return undefined; });
    await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission)).rejects.toMatchObject({ cause: first });
    expect(f.clear).toHaveBeenCalledOnce();
  });

  it('captures the original callbacks across the first asynchronous check', async () => {
    const f = await fixture(); const first = new Error('synthetic original content rejection');
    f.assertCurrent.mockImplementationOnce(async () => {
      f.admission.assertCurrent = async () => {};
      f.admission.assertContent = async () => {};
    });
    f.assertContent.mockRejectedValue(first);
    await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission)).rejects.toMatchObject({ cause: first });
    expect(f.clear).not.toHaveBeenCalled();
  });

  it.each(['prepare', 'validate', 'accept', 'rollback', 'selectorReturn'] as const)(
    'seals a competing %s call even when its rejection is caught', async action => {
      const f = await fixture();
      f.assertContent.mockImplementationOnce(async () => {
        const other = action === 'prepare' ? f.recovery.prepareBeforeBackend()
          : action === 'validate' ? f.recovery.validateAfterBackend({ mode: 'normal',
            async stopBackend() {}, async validateActiveProfile() {} })
          : action === 'accept' ? f.recovery.acceptValidatedRestoredProfile({ assertTargetCanAccept() {} })
          : action === 'rollback' ? f.recovery.rollbackValidatedRestoredProfile()
          : f.recovery.completeRolledBackBeforeSelectorReturn(f.admission);
        await expect(other).rejects.toThrow('PROFILE_RESTORE_DECISION_INVALID');
      });
      await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission))
        .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(f.clear).not.toHaveBeenCalled(); expect(f.stored()).toEqual(f.selected);
    },
  );

  it.each(['normal', 'accepted', 'unverified', 'missingOriginal'] as const)(
    'does not turn %s state into rollback completion', async state => {
      const f = await fixture({ state });
      await expect(f.recovery.completeRolledBackBeforeSelectorReturn(f.admission))
        .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(f.clear).not.toHaveBeenCalled(); expect(f.assertContent).not.toHaveBeenCalled();
    },
  );
});

async function fixture(options: { state?: 'normal' | 'accepted' | 'unverified' | 'missingOriginal' } = {}) {
  const selected: ProfileRestoreActivationJournal = {
    formatVersion: 1, operationId: randomUUID(), phase: 'rolledBack', revision: 9,
    hadActiveDatabase: options.state !== 'missingOriginal', hadActiveDocuments: true,
  };
  let stored: ProfileRestoreActivationJournal | undefined = options.state === 'normal' ? undefined
    : { ...selected, phase: options.state === 'accepted' ? 'accepted'
      : options.state === 'unverified' ? 'validationStarting' : 'rolledBack' };
  const read = vi.fn(async () => stored); const peek = vi.fn(async () => stored);
  const assertCurrent = vi.fn(async () => {});
  const assertContent = vi.fn(async (_journal: Readonly<ProfileRestoreActivationJournal>) => {});
  const admission: ProfileRestoreColdRollbackAdmission = {
    kind: 'rollback', journal: { ...selected }, assertCurrent, assertContent, async beforeStagingMove() {},
    async beforeRollbackRootRemoval() { return { identity: 'a'.repeat(64), assertCurrent() {} }; },
  };
  const clear = vi.fn<ProfileRestoreActivationTransaction['clearRolledBack']>(async (_journal, guard) => {
    await guard!(); stored = undefined;
  });
  const transaction = {
    clearRolledBack: clear, clearAccepted: vi.fn(async () => {}),
    commitAcceptance: vi.fn(async () => { throw new Error('synthetic lost publication acknowledgement'); }),
    assertForwardRecoveryState: vi.fn(async () => {}),
    advanceToValidation: vi.fn(async () => stored!),
    rollback: vi.fn(async () => { throw new Error('unexpected rollback'); }),
  };
  const observe = vi.fn();
  const recovery = new ProfileRestoreStartupRecovery({ journalStore: { peek, read }, transaction, observer: { observe } });
  if (options.state === 'missingOriginal') await expect(recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
  else {
    const mode = await recovery.prepareBeforeBackend();
    if (options.state === 'unverified') {
      await recovery.validateAfterBackend({ mode, deferRestoredProfileAcceptance: true,
        async stopBackend() {}, async validateActiveProfile() {} });
      await expect(recovery.acceptValidatedRestoredProfile({ assertTargetCanAccept() {} })).rejects.toThrow();
      expect(recovery.readAcceptanceState()).toBe('unverified');
    }
  }
  return { recovery, selected, admission, assertCurrent, assertContent, clear, transaction, peek, read, observe,
    stored: () => stored };
}
