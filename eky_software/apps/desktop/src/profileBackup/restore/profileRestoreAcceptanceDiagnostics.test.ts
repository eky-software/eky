import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { profileInspectionFailureCauses } from '../../runtime/profileInspectionFailure.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import type { ProfileRestoreTerminalMutationAuthority } from './profileRestoreActivationTransaction.js';
import { ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';

type FailureStage = 'preparation' | 'commit' | 'cleanup';
const stageNames = {
  preparation: 'acceptancePreparation', commit: 'acceptanceCommit', cleanup: 'acceptedCleanup',
} as const;

describe('restore acceptance diagnostics', () => {
  it.each(profileInspectionFailureCauses)('retains %s in each terminal stage and invocation', async cause => {
    for (const deferred of [false, true]) {
      for (const stage of ['preparation', 'commit', 'cleanup'] as const) {
        const primary = new Error('synthetic wrapper', { cause: new Error(cause) });
        const fixture = createFixture({ stage, primary, deferred });
        await expect(fixture.run()).rejects.toBeInstanceOf(Error);
        expect(fixture.events.filter(event => event.eventName === 'restore.acceptanceFailed')).toEqual([
          expect.objectContaining({ correlationId: fixture.journal.operationId, durationMs: expect.any(Number),
            errorCode: cause, stage: stageNames[stage], retryable: false, sideEffectState: 'unknown' }),
        ]);
        expect(fixture.events.map(event => event.eventName)).toContain('restore.validationCompleted');
        expect(fixture.events.map(event => event.eventName)).not.toContain('restore.validationFailed');
        expect(fixture.recovery.readAcceptanceState()).toBe(
          stage === 'preparation' ? 'notStarted' : stage === 'commit' ? 'unverified' : 'committed',
        );
        expect(fixture.transaction.rollback).not.toHaveBeenCalled();
      }
    }
  });

  it.each([false, true])('does not replace the first cause with backend stop failure (known: %s)', async known => {
    const primary = new Error(known ? 'PROFILE_INSPECTION_TIMEOUT' : 'synthetic unknown failure');
    const stop = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    const fixture = createFixture({ stage: 'preparation', primary });
    fixture.stopBackend.mockRejectedValueOnce(stop);
    await expect(fixture.run()).rejects.toMatchObject({ cause: { errors: [primary, stop] } });
    expect(fixture.events.filter(event => event.eventName === 'restore.acceptanceFailed')).toEqual([
      expect.objectContaining({ errorCode: known ? primary.message : 'PROFILE_RESTORE_RECOVERY_REQUIRED' }),
    ]);
    expect(fixture.events.filter(event => event.eventName === 'restore.recoveryRequired')).toEqual([
      expect.objectContaining({ errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED' }),
    ]);
  });

  it('does not promote a secondary cleanup cause from an aggregate', async () => {
    const fixture = createFixture({ stage: 'preparation', primary: new AggregateError([
      new Error('synthetic unknown primary'), new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
    ]) });
    await expect(fixture.run()).rejects.toBeInstanceOf(Error);
    expect(fixture.events).toContainEqual(expect.objectContaining({
      eventName: 'restore.acceptanceFailed', errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
    }));
  });

  it('observes resumed accepted cleanup without committing again', async () => {
    const fixture = createFixture({ stage: 'cleanup', primary: new Error('PROFILE_SCHEMA_UNSUPPORTED'), accepted: true });
    await expect(fixture.run()).rejects.toBeInstanceOf(Error);
    expect(fixture.transaction.commitAcceptance).not.toHaveBeenCalled();
    expect(fixture.recovery.readAcceptanceState()).toBe('committed');
    expect(fixture.events).toContainEqual(expect.objectContaining({
      eventName: 'restore.acceptanceFailed', stage: 'acceptedCleanup', errorCode: 'PROFILE_SCHEMA_UNSUPPORTED',
    }));
  });

  it('reports preparation on an accepted journal before its cleanup callback starts', async () => {
    const fixture = createFixture({ stage: 'preparation', primary: new Error('PROFILE_INSPECTION_TIMEOUT'), accepted: true });
    await expect(fixture.run()).rejects.toBeInstanceOf(Error);
    expect(fixture.transaction.clearAccepted).not.toHaveBeenCalled();
    expect(fixture.recovery.readAcceptanceState()).toBe('committed');
    expect(fixture.events).toContainEqual(expect.objectContaining({
      eventName: 'restore.acceptanceFailed', stage: 'acceptancePreparation', errorCode: 'PROFILE_INSPECTION_TIMEOUT',
    }));
  });

  it('retains correlation after transaction cleanup when authority release fails', async () => {
    const fixture = createFixture({ releaseFails: true });
    await expect(fixture.run()).rejects.toMatchObject({ cause: { message: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' } });
    expect(fixture.transaction.clearAccepted).toHaveBeenCalledOnce();
    expect(fixture.recovery.readAcceptanceState()).toBe('committed');
    expect(fixture.events.filter(event => event.eventName === 'restore.acceptanceFailed')).toEqual([
      expect.objectContaining({ correlationId: fixture.journal.operationId, stage: 'acceptedCleanup',
        errorCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' }),
    ]);
    expect(fixture.transaction.rollback).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps the original failure despite observer rejection (deferred: %s)', async deferred => {
    const primary = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    const fixture = createFixture({ stage: 'commit', primary, deferred, loggerFails: true });
    const outcome = fixture.run();
    if (deferred) await expect(outcome).rejects.toBe(primary);
    else await expect(outcome).rejects.toMatchObject({ cause: primary });
    expect(fixture.recovery.readAcceptanceState()).toBe('unverified');
    expect(fixture.transaction.clearAccepted).not.toHaveBeenCalled();
    expect(fixture.transaction.rollback).not.toHaveBeenCalled();
  });

  it.each(['immediate', 'deferred', 'accepted'] as const)('keeps successful %s acceptance free of failure events', async mode => {
    const fixture = createFixture({ deferred: mode === 'deferred', accepted: mode === 'accepted' });
    await fixture.run();
    expect(fixture.events.map(event => event.eventName)).toEqual(['restore.validationCompleted']);
    expect(fixture.transaction.commitAcceptance).toHaveBeenCalledTimes(mode === 'accepted' ? 0 : 1);
    expect(fixture.transaction.clearAccepted).toHaveBeenCalledOnce();
    expect(fixture.stopBackend).not.toHaveBeenCalled();
  });
});

function createFixture(options: {
  stage?: FailureStage; primary?: Error; deferred?: boolean; accepted?: boolean; loggerFails?: boolean; releaseFails?: boolean;
}) {
  const journal: ProfileRestoreActivationJournal = {
    formatVersion: 1, operationId: randomUUID(), phase: options.accepted ? 'accepted' : 'validationStarting',
    revision: 1, hadActiveDatabase: true, hadActiveDocuments: true,
  };
  const transaction = {
    advanceToValidation: vi.fn(async () => journal),
    assertForwardRecoveryState: vi.fn(async () => {}),
    commitAcceptance: vi.fn(async (selected: Readonly<ProfileRestoreActivationJournal>) => {
      if (options.stage === 'commit') throw options.primary;
      return { ...selected, phase: 'accepted' as const, revision: selected.revision + 1 };
    }),
    clearAccepted: vi.fn(async () => { if (options.stage === 'cleanup') throw options.primary; }),
    clearRolledBack: vi.fn(async () => {}), rollback: vi.fn(async () => journal),
  };
  const events: ProfileRecoveryOperationalEvent[] = [];
  const recovery = new ProfileRestoreStartupRecovery({
    journalStore: { peek: async () => journal, read: async () => journal }, transaction,
    ...(options.stage === 'preparation' ? { withTerminalAuthority: async () => { throw options.primary; } } : {}),
    ...(options.releaseFails ? { withTerminalAuthority: async (
      selected: Readonly<ProfileRestoreActivationJournal>,
      use: (authority: ProfileRestoreTerminalMutationAuthority) => Promise<void>,
    ) => {
      await use({ census: { journal: selected, roots: [] }, assertCurrent: async () => {} });
      throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    } } : {}),
    observer: { observe(event) {
      if (options.loggerFails) throw new Error('synthetic observer failure');
      events.push(event);
    } },
  });
  const stopBackend = vi.fn(async () => {});
  return { journal, recovery, transaction, events, stopBackend, async run() {
    const mode = await recovery.prepareBeforeBackend();
    await recovery.validateAfterBackend({ mode, stopBackend, validateActiveProfile: async () => {},
      deferRestoredProfileAcceptance: options.deferred === true });
    if (options.deferred) await recovery.acceptValidatedRestoredProfile({ assertTargetCanAccept() {} });
  } };
}
