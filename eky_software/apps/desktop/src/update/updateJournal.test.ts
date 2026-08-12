import { describe, expect, it } from 'vitest';

import {
  parseUpdateJournal,
  transitionUpdateJournal,
  UpdateJournalValidationError,
  type UpdateJournal,
} from './updateJournal.js';

const recoveryPointReference = '11111111-1111-4111-8111-111111111111';

describe('update journal', () => {
  it('accepts only the bounded journal schema', () => {
    const journal = createJournal();
    expect(parseUpdateJournal(journal)).toEqual(journal);

    for (const invalid of [
      { ...journal, profilePath: 'C:/Users/example/profile' },
      { ...journal, commandLine: 'msiexec /i private.msi' },
      { ...journal, releaseChannel: 'stable' },
      { ...journal, revision: 0 },
      { ...journal, targetVersion: journal.currentVersion },
      {
        ...journal,
        candidatePackageIdentity: {
          ...journal.candidatePackageIdentity,
          packageSha256: 'not-a-sha',
        },
      },
    ]) {
      expect(() => parseUpdateJournal(invalid)).toThrow(
        UpdateJournalValidationError,
      );
    }
  });

  it('allows failure before a recovery point without inventing a reference', () => {
    const failed = transitionUpdateJournal(createJournal(), {
      at: '2026-08-11T18:01:00.000Z',
      state: 'failed',
    });
    expect(failed).toMatchObject({
      handoffAttemptCount: 0,
      revision: 2,
      state: 'failed',
    });
    expect(failed).not.toHaveProperty('recoveryPointReference');
  });

  it('requires a recovery reference before runtime shutdown', () => {
    expect(() =>
      transitionUpdateJournal(createJournal(), {
        at: '2026-08-11T18:01:00.000Z',
        state: 'recoveryPointValidated',
      }),
    ).toThrow(UpdateJournalValidationError);

    const protectedJournal = transitionUpdateJournal(createJournal(), {
      at: '2026-08-11T18:01:00.000Z',
      recoveryPointReference,
      state: 'recoveryPointValidated',
    });
    expect(protectedJournal.recoveryPointReference).toBe(
      recoveryPointReference,
    );
  });

  it('requires exactly one handoff before awaiting first start', () => {
    const protectedJournal = transitionUpdateJournal(createJournal(), {
      at: '2026-08-11T18:01:00.000Z',
      recoveryPointReference,
      state: 'recoveryPointValidated',
    });
    const stopping = transitionUpdateJournal(protectedJournal, {
      at: '2026-08-11T18:02:00.000Z',
      state: 'runtimeStopping',
    });
    expect(() =>
      transitionUpdateJournal(stopping, {
        at: '2026-08-11T18:03:00.000Z',
        state: 'awaitingFirstStart',
      }),
    ).toThrow(UpdateJournalValidationError);

    expect(
      transitionUpdateJournal(stopping, {
        at: '2026-08-11T18:03:00.000Z',
        handoffAttemptCount: 1,
        state: 'awaitingFirstStart',
      }),
    ).toMatchObject({ handoffAttemptCount: 1, state: 'awaitingFirstStart' });
  });

  it('rejects backwards transitions and keeps repeated state writes idempotent', () => {
    const protectedJournal = transitionUpdateJournal(createJournal(), {
      at: '2026-08-11T18:01:00.000Z',
      recoveryPointReference,
      state: 'recoveryPointValidated',
    });
    expect(() =>
      transitionUpdateJournal(protectedJournal, {
        at: '2026-08-11T18:02:00.000Z',
        state: 'prepared',
      }),
    ).toThrow(UpdateJournalValidationError);

    const repeated = transitionUpdateJournal(protectedJournal, {
      at: '2026-08-11T18:02:00.000Z',
      state: 'recoveryPointValidated',
    });
    expect(repeated.revision).toBe(protectedJournal.revision);
    expect(repeated.updatedAt).toBe('2026-08-11T18:02:00.000Z');
  });

  it('allows rollback only through business restore before one binary handoff', () => {
    const awaitingFirstStart = createJournal({
      binaryRollbackAttemptCount: 0,
      handoffAttemptCount: 1,
      preUpdateMigrationChainIdentity: 'c'.repeat(64),
      recoveryPointReference,
      revision: 4,
      state: 'awaitingFirstStart',
    });
    const businessStarting = transitionUpdateJournal(awaitingFirstStart, {
      at: '2026-08-11T18:04:00.000Z',
      state: 'businessRollbackStarting',
    });
    const businessCompleted = transitionUpdateJournal(businessStarting, {
      at: '2026-08-11T18:05:00.000Z',
      state: 'businessRollbackCompleted',
    });
    const packageRequired = transitionUpdateJournal(businessCompleted, {
      at: '2026-08-11T18:05:30.000Z',
      state: 'rollbackPackageRequired',
    });
    expect(
      transitionUpdateJournal(packageRequired, {
        at: '2026-08-11T18:05:45.000Z',
        state: 'businessRollbackCompleted',
      }),
    ).toMatchObject({
      binaryRollbackAttemptCount: 0,
      state: 'businessRollbackCompleted',
    });

    expect(() =>
      transitionUpdateJournal(businessStarting, {
        at: '2026-08-11T18:05:00.000Z',
        binaryRollbackAttemptCount: 1,
        state: 'binaryRollbackPrepared',
      }),
    ).toThrow(UpdateJournalValidationError);

    const binaryPrepared = transitionUpdateJournal(businessCompleted, {
      at: '2026-08-11T18:06:00.000Z',
      binaryRollbackAttemptCount: 1,
      state: 'binaryRollbackPrepared',
    });
    const awaitingRollbackFirstStart = transitionUpdateJournal(
      binaryPrepared,
      {
        at: '2026-08-11T18:07:00.000Z',
        state: 'awaitingRollbackFirstStart',
      },
    );
    expect(
      transitionUpdateJournal(awaitingRollbackFirstStart, {
        at: '2026-08-11T18:08:00.000Z',
        state: 'rolledBack',
      }),
    ).toMatchObject({
      binaryRollbackAttemptCount: 1,
      state: 'rolledBack',
    });
  });

  it('keeps recovery-required terminal and rejects a second rollback attempt', () => {
    const binaryPrepared = createJournal({
      binaryRollbackAttemptCount: 1,
      handoffAttemptCount: 1,
      preUpdateMigrationChainIdentity: 'c'.repeat(64),
      recoveryPointReference,
      revision: 7,
      state: 'binaryRollbackPrepared',
    });
    expect(() =>
      transitionUpdateJournal(binaryPrepared, {
        at: '2026-08-11T18:08:00.000Z',
        binaryRollbackAttemptCount: 0,
        state: 'binaryRollbackPrepared',
      }),
    ).toThrow(UpdateJournalValidationError);

    const recoveryRequired = transitionUpdateJournal(binaryPrepared, {
      at: '2026-08-11T18:08:00.000Z',
      state: 'recoveryRequired',
    });
    expect(() =>
      transitionUpdateJournal(recoveryRequired, {
        at: '2026-08-11T18:09:00.000Z',
        state: 'binaryRollbackPrepared',
      }),
    ).toThrow(UpdateJournalValidationError);
  });
});

export function createJournal(
  overrides: Partial<UpdateJournal> = {},
): UpdateJournal {
  return {
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: 'bbbbbbbbbbbb',
      msiProductVersion: '0.2.0',
      packageSha256: 'b'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-11T18:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'aaaaaaaaaaaa',
      msiProductVersion: '0.1.0',
      packageSha256: 'a'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.1.0',
    formatVersion: 1,
    handoffAttemptCount: 0,
    releaseChannel: 'pilot',
    revision: 1,
    state: 'prepared',
    targetVersion: '0.2.0',
    updatedAt: '2026-08-11T18:00:00.000Z',
    ...overrides,
  };
}
