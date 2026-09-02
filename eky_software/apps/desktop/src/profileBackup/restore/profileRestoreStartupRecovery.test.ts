import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';

describe('profile restore startup recovery', () => {
  it('finishes an interrupted activation before starting the backend', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: {
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
      journalStore: {
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
    expect(transaction.accept).toHaveBeenCalledTimes(1);
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
      journalStore: {
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
    expect(transaction.accept).not.toHaveBeenCalled();

    await expect(
      recovery.acceptValidatedRestoredProfile({
        assertTargetCanAccept: vi.fn(),
      }),
    ).resolves.toBeUndefined();
    expect(transaction.accept).toHaveBeenCalledTimes(1);
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
      journalStore: {
        read: vi.fn(async () =>
          createJournal(operationId, 'validationStarting'),
        ),
      },
      transaction,
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
    expect(transaction.accept).not.toHaveBeenCalled();

    await expect(
      recovery.rollbackValidatedRestoredProfile(),
    ).resolves.toBeUndefined();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('can roll back a healthy restored profile while acceptance is deferred', async () => {
    const operationId = randomUUID();
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: {
        read: vi.fn(async () =>
          createJournal(operationId, 'validationStarting'),
        ),
      },
      transaction,
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
    expect(transaction.accept).not.toHaveBeenCalled();
  });

  it('rolls back an unhealthy restored profile and requests a fresh process', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const transaction = createTransaction(operationId);
    const stopBackend = vi.fn();
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: {
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
      journalStore: {
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

  it('reports a failed-safe startup journal before blocking startup', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: {
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
      journalStore: {
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

function createTransaction(operationId: string) {
  return {
    accept: vi.fn(),
    advanceToValidation: vi.fn(async () =>
      createJournal(operationId, 'validationStarting'),
    ),
    clearRolledBack: vi.fn(),
    rollback: vi.fn(async () =>
      createJournal(operationId, 'rolledBack'),
    ),
  };
}

function createJournal(
  operationId: string,
  phase:
    | 'currentDatabaseMoved'
    | 'failedSafe'
    | 'rollbackStarting'
    | 'rolledBack'
    | 'validationStarting',
) {
  return {
    formatVersion: 1 as const,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId,
    phase,
    revision: 1,
  };
}
