import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ProfileRestoreActivationService } from './profileRestoreActivationService.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';

describe('profile restore activation service', () => {
  it('revalidates, materializes and stops the runtime before activation', async () => {
    const order: string[] = [];
    const events: ProfileRecoveryOperationalEvent[] = [];
    const operationId = randomUUID();
    const service = new ProfileRestoreActivationService({
      observer: { observe: (event) => events.push(event) },
      profileSnapshotClient: {
        beginMaintenance: vi.fn(async () => {
          order.push('maintenance');
          return 'busy' as const;
        }),
        endMaintenance: vi.fn(async () => 'normal' as const),
        prepareProfileRestoreActivation: vi.fn(async () => {
          order.push('materialize');
          return {
            artifactCount: 0,
            artifactTotalByteSize: 0,
            type: 'profileRestoreActivationPrepared' as const,
          };
        }),
        validateProfileSnapshot: vi.fn(async () => {
          order.push('validate');
          return {
            activeProfileIsEmpty: false,
            artifactCount: 0,
            artifactTotalByteSize: 0,
            databaseHealth: 'healthy' as const,
            migrationChainIdentity: 'a'.repeat(64),
            profileId: 'b'.repeat(64),
            profileMatchesActive: true,
            type: 'profileSnapshotValidation' as const,
          };
        }),
      },
      relaunchApplication: () => order.push('relaunch'),
      stagingService: {
        getPreparedRestore: () => ({
          operationId,
          summary: createSummary(),
          targetDisposition: 'replaceActiveProfile',
        }),
      },
      stopBusinessRuntime: async () => {
        order.push('stop');
      },
      transaction: {
        advanceToValidation: vi.fn(async () => {
          order.push('activate');
          return createJournal(operationId, 'validationStarting');
        }),
        prepare: vi.fn(async () => {
          order.push('journal');
        }),
        rollback: vi.fn(),
      },
    });

    await expect(service.activate(operationId)).resolves.toBe(
      'relaunching',
    );
    expect(order).toEqual([
      'maintenance',
      'validate',
      'materialize',
      'journal',
      'stop',
      'activate',
      'relaunch',
    ]);
    expect(events).toEqual([
      {
        correlationId: operationId,
        eventName: 'restore.activationStarted',
        stage: 'activation',
      },
    ]);
  });

  it('does not stop or mutate the active profile when target identity changed', async () => {
    const operationId = randomUUID();
    const stopBusinessRuntime = vi.fn();
    const prepare = vi.fn();
    const endMaintenance = vi.fn(async () => 'normal' as const);
    const service = new ProfileRestoreActivationService({
      profileSnapshotClient: {
        beginMaintenance: vi.fn(async () => 'busy' as const),
        endMaintenance,
        prepareProfileRestoreActivation: vi.fn(),
        validateProfileSnapshot: vi.fn(async () => ({
          activeProfileIsEmpty: false,
          artifactCount: 0,
          artifactTotalByteSize: 0,
          databaseHealth: 'healthy' as const,
          migrationChainIdentity: 'a'.repeat(64),
          profileId: 'b'.repeat(64),
          profileMatchesActive: false,
          type: 'profileSnapshotValidation' as const,
        })),
      },
      relaunchApplication: vi.fn(),
      stagingService: {
        getPreparedRestore: () => ({
          operationId,
          summary: createSummary(),
          targetDisposition: 'replaceActiveProfile',
        }),
      },
      stopBusinessRuntime,
      transaction: {
        advanceToValidation: vi.fn(),
        prepare,
        rollback: vi.fn(),
      },
    });

    await expect(service.activate(operationId)).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_ACTIVATION_FAILED',
    });
    expect(endMaintenance).toHaveBeenCalledWith(operationId);
    expect(prepare).not.toHaveBeenCalled();
    expect(stopBusinessRuntime).not.toHaveBeenCalled();
  });

  it('rolls back and relaunches when activation fails after shutdown', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const rollback = vi.fn(async () =>
      createJournal(operationId, 'rolledBack'),
    );
    const relaunchApplication = vi.fn();
    const service = new ProfileRestoreActivationService({
      observer: { observe: (event) => events.push(event) },
      profileSnapshotClient: createSnapshotClient(),
      relaunchApplication,
      stagingService: {
        getPreparedRestore: () => ({
          operationId,
          summary: createSummary(),
          targetDisposition: 'replaceActiveProfile',
        }),
      },
      stopBusinessRuntime: vi.fn(),
      transaction: {
        advanceToValidation: vi.fn(async () => {
          throw new Error('interrupted');
        }),
        prepare: vi.fn(),
        rollback,
      },
    });

    await expect(service.activate(operationId)).resolves.toBe(
      'relaunching',
    );
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(relaunchApplication).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.activationStarted',
      }),
      expect.objectContaining({
        correlationId: operationId,
        errorCode: 'PROFILE_RESTORE_ACTIVATION_FAILED',
        eventName: 'restore.activationFailed',
        stage: 'activation',
      }),
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.rollbackStarted',
        stage: 'activationRollback',
      }),
      expect.objectContaining({
        correlationId: operationId,
        eventName: 'restore.rollbackCompleted',
        stage: 'activationRollback',
      }),
    ]);
  });

  it.each([
    'maintenance',
    'revalidation',
    'preparation',
    'transactionPrepare',
    'runtimeStop',
    'activationAdvance',
  ] as const)(
    'writes exactly one terminal activation failure at %s',
    async (failurePoint) => {
      const operationId = randomUUID();
      const events: ProfileRecoveryOperationalEvent[] = [];
      const failAt = (point: typeof failurePoint): void => {
        if (failurePoint === point) {
          throw new Error('PROFILE_RESTORE_SYNTHETIC_FAILURE');
        }
      };
      const service = new ProfileRestoreActivationService({
        observer: { observe: (event) => events.push(event) },
        profileSnapshotClient: {
          beginMaintenance: vi.fn(async () => {
            failAt('maintenance');
            return 'busy' as const;
          }),
          endMaintenance: vi.fn(async () => 'normal' as const),
          prepareProfileRestoreActivation: vi.fn(async () => {
            failAt('preparation');
            return {
              artifactCount: 0,
              artifactTotalByteSize: 0,
              type: 'profileRestoreActivationPrepared' as const,
            };
          }),
          validateProfileSnapshot: vi.fn(async () => {
            failAt('revalidation');
            return {
              activeProfileIsEmpty: false,
              artifactCount: 0,
              artifactTotalByteSize: 0,
              databaseHealth: 'healthy' as const,
              migrationChainIdentity: 'a'.repeat(64),
              profileId: 'b'.repeat(64),
              profileMatchesActive: true,
              type: 'profileSnapshotValidation' as const,
            };
          }),
        },
        relaunchApplication: vi.fn(),
        stagingService: {
          getPreparedRestore: () => ({
            operationId,
            summary: createSummary(),
            targetDisposition: 'replaceActiveProfile',
          }),
        },
        stopBusinessRuntime: vi.fn(async () => {
          failAt('runtimeStop');
        }),
        transaction: {
          advanceToValidation: vi.fn(async () => {
            failAt('activationAdvance');
            return createJournal(operationId, 'validationStarting');
          }),
          prepare: vi.fn(async () => {
            failAt('transactionPrepare');
          }),
          rollback: vi.fn(async () =>
            createJournal(operationId, 'rolledBack'),
          ),
        },
      });

      if (failurePoint === 'activationAdvance') {
        await expect(service.activate(operationId)).resolves.toBe(
          'relaunching',
        );
      } else {
        await expect(service.activate(operationId)).rejects.toMatchObject({
          code: 'PROFILE_RESTORE_ACTIVATION_FAILED',
        });
      }

      expect(
        events.filter(
          ({ eventName }) => eventName === 'restore.activationFailed',
        ),
      ).toEqual([
        expect.objectContaining({
          correlationId: operationId,
          errorCode: 'PROFILE_RESTORE_SYNTHETIC_FAILURE',
          retryable: false,
          stage: 'activation',
        }),
      ]);
    },
  );

  it('reports recovery required when activation rollback fails', async () => {
    const operationId = randomUUID();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const service = new ProfileRestoreActivationService({
      observer: { observe: (event) => events.push(event) },
      profileSnapshotClient: createSnapshotClient(),
      relaunchApplication: vi.fn(),
      stagingService: {
        getPreparedRestore: () => ({
          operationId,
          summary: createSummary(),
          targetDisposition: 'replaceActiveProfile',
        }),
      },
      stopBusinessRuntime: vi.fn(),
      transaction: {
        advanceToValidation: vi.fn(async () => {
          throw new Error('interrupted');
        }),
        prepare: vi.fn(),
        rollback: vi.fn(async () => {
          throw new Error('rollback interrupted');
        }),
      },
    });

    await expect(service.activate(operationId)).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
    });
    expect(events.map(({ eventName }) => eventName)).toEqual([
      'restore.activationStarted',
      'restore.activationFailed',
      'restore.rollbackStarted',
      'restore.rollbackFailed',
      'restore.recoveryRequired',
    ]);
    expect(events.at(-1)).toEqual({
      correlationId: operationId,
      errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      eventName: 'restore.recoveryRequired',
      retryable: false,
      sideEffectState: 'unknown',
      stage: 'activationRollback',
    });
  });

  it('keeps activation rollback authoritative when a custom observer throws', async () => {
    const operationId = randomUUID();
    const rollback = vi.fn(async () =>
      createJournal(operationId, 'rolledBack'),
    );
    const service = new ProfileRestoreActivationService({
      observer: {
        observe() {
          throw new Error('SYNTHETIC_LOG_WRITE_FAILURE');
        },
      },
      profileSnapshotClient: createSnapshotClient(),
      relaunchApplication: vi.fn(),
      stagingService: {
        getPreparedRestore: () => ({
          operationId,
          summary: createSummary(),
          targetDisposition: 'replaceActiveProfile',
        }),
      },
      stopBusinessRuntime: vi.fn(),
      transaction: {
        advanceToValidation: vi.fn(async () => {
          throw new Error('PROFILE_RESTORE_ACTIVATION_FAILED');
        }),
        prepare: vi.fn(),
        rollback,
      },
    });

    await expect(service.activate(operationId)).resolves.toBe(
      'relaunching',
    );
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});

function createSnapshotClient() {
  return {
    beginMaintenance: vi.fn(async () => 'busy' as const),
    endMaintenance: vi.fn(async () => 'normal' as const),
    prepareProfileRestoreActivation: vi.fn(async () => ({
      artifactCount: 0,
      artifactTotalByteSize: 0,
      type: 'profileRestoreActivationPrepared' as const,
    })),
    validateProfileSnapshot: vi.fn(async () => ({
      activeProfileIsEmpty: false,
      artifactCount: 0,
      artifactTotalByteSize: 0,
      databaseHealth: 'healthy' as const,
      migrationChainIdentity: 'a'.repeat(64),
      profileId: 'b'.repeat(64),
      profileMatchesActive: true,
      type: 'profileSnapshotValidation' as const,
    })),
  };
}

function createSummary() {
  return {
    appVersion: '0.1.0-alpha.1',
    compatibilityStatus: 'compatible' as const,
    createdAt: '2026-08-04T00:00:00.000Z',
    databaseHealth: 'healthy' as const,
    documentCount: 0,
    formatVersion: 1 as const,
    profileMatchStatus: 'same' as const,
    totalBusinessByteSize: 1,
  };
}

function createJournal(
  operationId: string,
  phase: 'rolledBack' | 'validationStarting',
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
