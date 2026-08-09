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
    const transaction = createTransaction(operationId);
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: {
        read: vi.fn(async () =>
          createJournal(operationId, 'rolledBack'),
        ),
      },
      transaction,
    });

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
