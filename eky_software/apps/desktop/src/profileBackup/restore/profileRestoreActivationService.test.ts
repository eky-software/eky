import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ProfileRestoreActivationService } from './profileRestoreActivationService.js';
import { PreparedProfileRestoreOwner } from './preparedProfileRestoreOwner.js';
import { RecoveryPointRestoreStagingService } from './recoveryPointRestoreStagingService.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import { profileInspectionFailureCauses } from '../../runtime/profileInspectionFailure.js';
import type { ProfileInspectionReceipt } from '../../runtime/profileInspectionMessages.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';

describe('profile restore activation service', () => {
  it.each(['prepare', 'readback', 'release', 'stop', 'forward'] as const)(
    'retains recovery without compensating after authority is revoked during %s', async boundary => {
      const f = activationFixture();
      let current = true;
      const first = new Error('synthetic activation authority revoked');
      const revoke = async <T>(use: () => Promise<T>): Promise<T> => {
        const value = await use();
        current = false;
        return value;
      };
      if (boundary === 'prepare') {
        const original = f.transaction.prepare.getMockImplementation()!;
        f.transaction.prepare.mockImplementationOnce((...args) => revoke(() => original(...args)));
      } else if (boundary === 'readback') {
        f.transaction.readPreparation.mockImplementationOnce(async () => { current = false; return 'prepared'; });
      } else if (boundary === 'release') {
        f.profileSnapshotClient.releaseProfileSnapshot.mockImplementationOnce(async () => { current = false; });
      } else if (boundary === 'stop') {
        f.stopBusinessRuntime.mockImplementationOnce(async () => { current = false; });
      } else {
        f.transaction.advanceToValidation.mockImplementationOnce(async () => { current = false; throw first; });
      }
      const failure = await f.service.activate(f.operationId, async () => {
        if (!current) throw first;
      }).catch((error: unknown) => error) as Error;
      expect(failure).toMatchObject({ code: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
      expect(f.transaction.rollback).not.toHaveBeenCalled();
      expect(f.profileSnapshotClient.cancelProfileRestoreRetention).not.toHaveBeenCalled();
      expect(f.profileSnapshotClient.endRestoreMaintenance).not.toHaveBeenCalled();
      expect(f.relaunchApplication).not.toHaveBeenCalled();
      expect(() => f.stagingService.claimPreparedRestore(f.operationId)).toThrow('PROFILE_RESTORE_BUSY');
      if (boundary !== 'stop' && boundary !== 'forward') expect(f.stopBusinessRuntime).not.toHaveBeenCalled();
    },
  );

  it.each(['notPrepared', 'unreadable', 'mismatched'] as const)(
    'never treats an acknowledged journal write as proof when readback is %s', async variant => {
      const f = activationFixture();
      const readbackError = new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
      f.transaction.readPreparation.mockImplementationOnce(async () => {
        if (variant !== 'notPrepared') throw readbackError;
        return 'notPrepared';
      });
      await expect(f.service.activate(f.operationId)).rejects.toMatchObject({ code: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
      expect(f.profileSnapshotClient.retainProfileSnapshotForRecovery).toHaveBeenCalledWith(f.operationId);
      expect(f.profileSnapshotClient.releaseProfileSnapshot).not.toHaveBeenCalled();
      expect(f.profileSnapshotClient.cancelProfileRestoreRetention).not.toHaveBeenCalled();
      expect(f.profileSnapshotClient.endRestoreMaintenance).not.toHaveBeenCalled();
      expect(f.profileSnapshotClient.invalidateRestoreMaintenance).toHaveBeenCalledWith(f.operationId);
      expect(f.stopBusinessRuntime).not.toHaveBeenCalled();
      expect(f.transaction.advanceToValidation).not.toHaveBeenCalled();
      expect(() => f.stagingService.claimPreparedRestore(f.operationId)).toThrow('PROFILE_RESTORE_BUSY');
    },
  );

  it.each(['fenceBeforeRelease', 'release', 'fenceAfterRelease'] as const)(
    'preserves prepared recovery and first failure at %s without stopping the runtime', async variant => {
      const f = activationFixture();
      const original = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      if (variant === 'release') f.profileSnapshotClient.releaseProfileSnapshot.mockRejectedValueOnce(original);
      else {
        f.profileSnapshotClient.assertRestoreMaintenance
          .mockResolvedValueOnce('busy')
          .mockResolvedValueOnce('busy');
        if (variant === 'fenceAfterRelease') f.profileSnapshotClient.assertRestoreMaintenance.mockResolvedValueOnce('busy');
        f.profileSnapshotClient.assertRestoreMaintenance.mockRejectedValueOnce(original);
      }
      await expect(f.service.activate(f.operationId)).rejects.toMatchObject({
        code: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: original,
      });
      expect(f.transaction.readPreparation).toHaveBeenCalledWith(f.operationId,
        expect.objectContaining({ operationId: f.operationId, phase: 'prepared', revision: 0 }), expect.any(Function));
      expect(f.profileSnapshotClient.invalidateRestoreMaintenance).toHaveBeenCalledWith(f.operationId);
      expect(f.profileSnapshotClient.endRestoreMaintenance).not.toHaveBeenCalled();
      expect(f.stopBusinessRuntime).not.toHaveBeenCalled();
      expect(f.transaction.rollback).not.toHaveBeenCalled();
      expect(() => f.stagingService.claimPreparedRestore(f.operationId)).toThrow('PROFILE_RESTORE_BUSY');
    },
  );

  it('keeps the rejected write first when verified absence cannot cancel native retention', async () => {
    const f = activationFixture();
    const first = new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    const cancellationFailure = new Error('PROFILE_PROTECTION_OPERATION_INVALID');
    f.transaction.prepare.mockRejectedValueOnce(first);
    f.transaction.readPreparation.mockResolvedValueOnce('notPrepared');
    f.profileSnapshotClient.cancelProfileRestoreRetention.mockRejectedValueOnce(cancellationFailure);
    const error = await f.service.activate(f.operationId).catch((failure: unknown) => failure) as Error;
    expect(error).toMatchObject({ code: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
    expect((error.cause as AggregateError).errors).toEqual([first, cancellationFailure]);
    expect(f.profileSnapshotClient.endRestoreMaintenance).not.toHaveBeenCalled();
    expect(f.profileSnapshotClient.releaseProfileSnapshot).not.toHaveBeenCalled();
    expect(f.stopBusinessRuntime).not.toHaveBeenCalled();
    expect(() => f.stagingService.claimPreparedRestore(f.operationId)).toThrow('PROFILE_RESTORE_BUSY');
  });

  it('keeps a failed safe cancellation separate from the original pre-journal failure', async () => {
    const f = activationFixture();
    const first = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const cancellationFailure = new Error('PROFILE_PROTECTION_OPERATION_INVALID');
    f.profileSnapshotClient.prepareProfileRestoreSnapshot.mockRejectedValueOnce(first);
    f.profileSnapshotClient.endRestoreMaintenance.mockRejectedValueOnce(cancellationFailure);
    const error = await f.service.activate(f.operationId).catch((failure: unknown) => failure) as Error;
    expect(error).toMatchObject({ code: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
    expect((error.cause as AggregateError).errors).toEqual([first, cancellationFailure]);
    expect(f.transaction.prepare).not.toHaveBeenCalled();
    expect(f.profileSnapshotClient.invalidateRestoreMaintenance).toHaveBeenCalledWith(f.operationId);
    expect(() => f.stagingService.claimPreparedRestore(f.operationId)).toThrow('PROFILE_RESTORE_BUSY');
  });

  it.each(['prepared', 'readFailed', 'notPrepared'] as const)(
    'preserves the actual prepared caller according to journal readback: %s', async (readback) => {
      const operationId = randomUUID();
      const original = new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
      const readbackError = new Error('PROFILE_RESTORE_JOURNAL_INVALID');
      const events: ProfileRecoveryOperationalEvent[] = [];
      const stagingService = new RecoveryPointRestoreStagingService({
        profileSnapshotClient: {
          async withInspectionOperation<T>(use: () => Promise<T>) { return use(); },
          async withProfileSnapshot<T>(_id: string, use: (receipt: ProfileInspectionReceipt) => Promise<T>) {
            return use({
              artifactCount: 0, artifactIdentity: 'e'.repeat(64), artifactTotalByteSize: 0, databaseHealth: 'healthy',
              migrationChainIdentity: 'a'.repeat(64), profileId: 'b'.repeat(64), migrationPolicy: 'restoreCompatible',
              database: { byteSize: 1, sha256: 'c'.repeat(64) }, artifactCatalog: { byteSize: 1, sha256: 'd'.repeat(64) },
            });
          },
          removeProfileSnapshot: vi.fn(),
        },
        store: {
        stageForRestore: vi.fn(async () => ({
          appVersion: '0.1.0-alpha.1', artifactTotalByteSize: 0,
          createdAt: '2026-08-04T00:00:00.000Z', documentCount: 0,
          migrationChainIdentity: 'a'.repeat(64), operationRoot: 'C:\\private\\staging', profileId: 'b'.repeat(64),
        })),
      } });
      await stagingService.stage({
        artifactId: randomUUID(), expectedMigrationChainIdentity: 'a'.repeat(64), operationId,
      });
      const stopBusinessRuntime = vi.fn();
      const profileSnapshotClient = createSnapshotClient();
      const transaction = {
        readOwnForwardProgress: vi.fn(),
        advanceToValidation: vi.fn(), prepare: createPreparation(operationId, () => { throw original; }),
        readPreparation: vi.fn(async () => {
          if (readback === 'readFailed') throw readbackError;
          return readback;
        }),
        rollback: vi.fn(),
      };
      const service = new ProfileRestoreActivationService({
        observer: { observe: event => events.push(event) }, profileSnapshotClient,
        relaunchApplication: vi.fn(), stagingService, stopBusinessRuntime, transaction,
      });

      const failure = await service.activate(operationId).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: readback === 'notPrepared'
        ? 'PROFILE_RESTORE_ACTIVATION_FAILED' : 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
      if (readback === 'readFailed') {
        expect((failure as Error).cause).toBeInstanceOf(AggregateError);
        expect(((failure as Error).cause as AggregateError).errors).toEqual([original, readbackError]);
      } else {
        expect((failure as Error).cause).toBe(original);
      }
      expect(events[1]).toMatchObject({
        eventName: 'restore.activationFailed', errorCode: original.message,
        sideEffectState: readback === 'notPrepared' ? 'none' : 'unknown',
      });
      expect(stopBusinessRuntime).not.toHaveBeenCalled();
      expect(transaction.advanceToValidation).not.toHaveBeenCalled();
      expect(transaction.rollback).not.toHaveBeenCalled();
      if (readback === 'notPrepared') {
        expect(profileSnapshotClient.endRestoreMaintenance).toHaveBeenCalledWith(operationId);
        expect(profileSnapshotClient.cancelProfileRestoreRetention).toHaveBeenCalledWith(operationId);
        const claim = stagingService.claimPreparedRestore(operationId)!;
        expect(claim.prepared.operationId).toBe(operationId);
        claim.release();
      } else {
        expect(profileSnapshotClient.endRestoreMaintenance).not.toHaveBeenCalled();
        expect(profileSnapshotClient.cancelProfileRestoreRetention).not.toHaveBeenCalled();
        expect(profileSnapshotClient.invalidateRestoreMaintenance).toHaveBeenCalledWith(operationId);
        expect(stagingService.getPreparedRestore(operationId)).toBeUndefined();
        expect(() => stagingService.claimPreparedRestore(operationId)).toThrow('PROFILE_RESTORE_BUSY');
        expect(events.at(-1)).toEqual({
          correlationId: operationId, errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          eventName: 'restore.recoveryRequired', retryable: false,
          sideEffectState: 'unknown', stage: 'activation',
        });
      }
    },
  );

  it('consumes the prepared slot before stopping and never reuses it after a failed stop', async () => {
    const operationId = randomUUID();
    const owner = new PreparedProfileRestoreOwner();
    owner.set({ operationId, summary: createSummary(), targetDisposition: 'replaceActiveProfile' });
    const original = new Error('RUNTIME_STOP_UNVERIFIED');
    const profileSnapshotClient = createSnapshotClient();
    const events: ProfileRecoveryOperationalEvent[] = [];
    const transaction = { prepare: createPreparation(operationId), readPreparation: vi.fn(async () => 'prepared' as const), readOwnForwardProgress: vi.fn(), advanceToValidation: vi.fn(), rollback: vi.fn() };
    const service = new ProfileRestoreActivationService({
      observer: { observe: event => events.push(event) },
      profileSnapshotClient, relaunchApplication: vi.fn(),
      stagingService: { claimPreparedRestore: id => owner.claim(id) }, transaction,
      async stopBusinessRuntime() {
        expect(owner.get(operationId)).toBeUndefined();
        expect(() => owner.clear(operationId)).toThrow('PROFILE_RESTORE_BUSY');
        throw original;
      },
    });
    await expect(service.activate(operationId)).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: original,
    });
    await expect(service.activate(operationId)).rejects.toThrow('PROFILE_RESTORE_BUSY');
    expect(transaction.prepare).toHaveBeenCalledTimes(1);
    expect(transaction.advanceToValidation).not.toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(profileSnapshotClient.endRestoreMaintenance).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      eventName: 'restore.recoveryRequired', stage: 'activation',
      errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED', sideEffectState: 'unknown',
    });
  });

  it.each(profileInspectionFailureCauses)('keeps wrapped %s in diagnostics before activation', async (cause) => {
    const operationId = randomUUID();
    const original = new Error('synthetic private activation detail', { cause: new Error(cause) });
    const events: ProfileRecoveryOperationalEvent[] = [];
    const profileSnapshotClient = createSnapshotClient();
    profileSnapshotClient.prepareProfileRestoreSnapshot.mockRejectedValueOnce(original);
    const stopBusinessRuntime = vi.fn();
    const transaction = { advanceToValidation: vi.fn(), prepare: vi.fn(), readPreparation: vi.fn(), readOwnForwardProgress: vi.fn(), rollback: vi.fn() };
    const service = new ProfileRestoreActivationService({
      observer: { observe: (event) => events.push(event) },
      profileSnapshotClient,
      relaunchApplication: vi.fn(),
      stagingService: createStagingOwner(operationId),
      stopBusinessRuntime,
      transaction,
    });
    await expect(service.activate(operationId)).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_ACTIVATION_FAILED', cause: original,
    });
    expect(events.at(-1)).toMatchObject({
      errorCode: cause, eventName: 'restore.activationFailed',
      retryable: false, sideEffectState: 'none', stage: 'activation',
    });
    expect(JSON.stringify(events)).not.toContain(original.message);
    expect(profileSnapshotClient.endRestoreMaintenance).toHaveBeenCalledWith(operationId);
    expect(stopBusinessRuntime).not.toHaveBeenCalled();
    expect(transaction.prepare).not.toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('revalidates, materializes and stops the runtime before activation', async () => {
    const order: string[] = [];
    const events: ProfileRecoveryOperationalEvent[] = [];
    const operationId = randomUUID();
    const service = new ProfileRestoreActivationService({
      observer: { observe: (event) => events.push(event) },
      profileSnapshotClient: {
        ...createSnapshotClient(),
        beginRestoreMaintenance: vi.fn(async () => {
          order.push('maintenance');
          return 'busy' as const;
        }),
        prepareProfileRestoreSnapshot: vi.fn(async () => {
          order.push('validateAndMaterialize');
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
        retainProfileSnapshotForRecovery: vi.fn(() => { order.push('retain'); }),
        releaseProfileSnapshot: vi.fn(async () => { order.push('release'); }),
      },
      relaunchApplication: () => order.push('relaunch'),
      stagingService: createStagingOwner(operationId),
      stopBusinessRuntime: async (id) => {
        expect(id).toBe(operationId);
        order.push('stop');
      },
      transaction: {
        advanceToValidation: vi.fn(async () => {
          order.push('activate');
          return createJournal(operationId, 'validationStarting');
        }),
        prepare: createPreparation(operationId, () => { order.push('journal'); }),
        readPreparation: vi.fn(async () => { order.push('readback'); return 'prepared' as const; }),
        readOwnForwardProgress: vi.fn(),
        rollback: vi.fn(),
      },
    });

    await expect(service.activate(operationId)).resolves.toBe(
      'relaunching',
    );
    expect(order).toEqual([
      'maintenance',
      'validateAndMaterialize',
      'retain',
      'journal',
      'readback',
      'release',
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
    const endRestoreMaintenance = vi.fn(async () => 'normal' as const);
    const service = new ProfileRestoreActivationService({
      profileSnapshotClient: {
        ...createSnapshotClient(),
        endRestoreMaintenance,
        prepareProfileRestoreSnapshot: vi.fn(async () => ({
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
      stagingService: createStagingOwner(operationId),
      stopBusinessRuntime,
      transaction: {
        advanceToValidation: vi.fn(),
        prepare,
        readPreparation: vi.fn(),
        readOwnForwardProgress: vi.fn(),
        rollback: vi.fn(),
      },
    });

    await expect(service.activate(operationId)).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_ACTIVATION_FAILED',
    });
    expect(endRestoreMaintenance).toHaveBeenCalledWith(operationId);
    expect(prepare).not.toHaveBeenCalled();
    expect(stopBusinessRuntime).not.toHaveBeenCalled();
  });

  it('preserves a rejected revalidation before any activation or runtime stop', async () => {
    const operationId = randomUUID();
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const profileSnapshotClient = createSnapshotClient();
    profileSnapshotClient.prepareProfileRestoreSnapshot.mockRejectedValueOnce(original);
    const stopBusinessRuntime = vi.fn();
    const transaction = {
      advanceToValidation: vi.fn(),
      prepare: vi.fn(),
      readPreparation: vi.fn(),
      readOwnForwardProgress: vi.fn(),
      rollback: vi.fn(),
    };
    const service = new ProfileRestoreActivationService({
      profileSnapshotClient,
      relaunchApplication: vi.fn(),
      stagingService: createStagingOwner(operationId),
      stopBusinessRuntime,
      transaction,
    });

    const failure: unknown = await service.activate(operationId)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'PROFILE_RESTORE_ACTIVATION_FAILED' });
    expect((failure as Error).cause).toBe(original);
    expect(profileSnapshotClient.endRestoreMaintenance).toHaveBeenCalledWith(operationId);
    expect(stopBusinessRuntime).not.toHaveBeenCalled();
    expect(transaction.prepare).not.toHaveBeenCalled();
    expect(transaction.advanceToValidation).not.toHaveBeenCalled();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(JSON.stringify(failure)).not.toContain(original.message);
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
      stagingService: createStagingOwner(operationId),
      stopBusinessRuntime: vi.fn(),
      transaction: {
        advanceToValidation: vi.fn(async () => {
          throw new Error('interrupted');
        }),
        prepare: createPreparation(operationId),
        readPreparation: vi.fn(async () => 'prepared' as const),
        readOwnForwardProgress: vi.fn(async () => createJournal(operationId, 'prepared')),
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
          ...createSnapshotClient(),
          beginRestoreMaintenance: vi.fn(async () => {
            failAt('maintenance');
            return 'busy' as const;
          }),
          prepareProfileRestoreSnapshot: vi.fn(async () => {
            failAt('revalidation');
            failAt('preparation');
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
        stagingService: createStagingOwner(operationId),
        stopBusinessRuntime: vi.fn(async () => {
          failAt('runtimeStop');
        }),
        transaction: {
          advanceToValidation: vi.fn(async () => {
            failAt('activationAdvance');
            return createJournal(operationId, 'validationStarting');
          }),
          prepare: vi.fn(async (_id: string, authority?: () => Promise<void>, capture?: (journal: Readonly<ProfileRestoreActivationJournal>) => void) => {
            failAt('transactionPrepare');
            await authority?.();
            capture?.(createJournal(operationId, 'prepared'));
          }),
          readPreparation: vi.fn(async () => failurePoint === 'transactionPrepare' ? 'notPrepared' as const : 'prepared' as const),
          readOwnForwardProgress: vi.fn(async () => createJournal(operationId, 'prepared')),
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
          code: failurePoint === 'runtimeStop'
            ? 'PROFILE_RESTORE_RECOVERY_REQUIRED' : 'PROFILE_RESTORE_ACTIVATION_FAILED',
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

  it.each([undefined, ...profileInspectionFailureCauses])(
    'preserves the primary %s when activation rollback also fails',
    async (cause) => {
      const operationId = randomUUID();
      const events: ProfileRecoveryOperationalEvent[] = [];
      const original = cause === undefined
        ? new Error('interrupted')
        : new Error('interrupted', { cause: new Error(cause) });
      const rollbackFailure = new Error('rollback interrupted');
      const service = new ProfileRestoreActivationService({
        observer: { observe: (event) => events.push(event) },
        profileSnapshotClient: createSnapshotClient(),
        relaunchApplication: vi.fn(),
        stagingService: createStagingOwner(operationId),
        stopBusinessRuntime: vi.fn(),
        transaction: {
          advanceToValidation: vi.fn(async () => {
            throw original;
          }),
          prepare: createPreparation(operationId),
          readPreparation: vi.fn(async () => 'prepared' as const),
          readOwnForwardProgress: vi.fn(async () => createJournal(operationId, 'prepared')),
          rollback: vi.fn(async () => {
            throw rollbackFailure;
          }),
        },
      });

      const failure: unknown = await service.activate(operationId)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      });
      expect((failure as Error).cause).toBeInstanceOf(AggregateError);
      const causes = ((failure as Error).cause as AggregateError).errors;
      expect(causes).toHaveLength(2);
      expect(causes[0]).toBe(original);
      expect(causes[1]).toBe(rollbackFailure);
      expect(JSON.stringify(failure)).not.toContain(original.message);
      expect(JSON.stringify(failure)).not.toContain(rollbackFailure.message);
      expect(events.map(({ eventName }) => eventName)).toEqual([
        'restore.activationStarted',
        'restore.activationFailed',
        'restore.rollbackStarted',
        'restore.rollbackFailed',
        'restore.recoveryRequired',
      ]);
      expect(events[1]).toMatchObject({
        errorCode: cause ?? 'PROFILE_RESTORE_ACTIVATION_FAILED',
        sideEffectState: 'unknown',
        stage: 'activation',
      });
      expect(events[3]).toMatchObject({
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        stage: 'activationRollback',
      });
      expect(JSON.stringify(events)).not.toContain(original.message);
      expect(JSON.stringify(events)).not.toContain(rollbackFailure.message);
      expect(events.at(-1)).toEqual({
        correlationId: operationId,
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        eventName: 'restore.recoveryRequired',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'activationRollback',
      });
    },
  );

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
      stagingService: createStagingOwner(operationId),
      stopBusinessRuntime: vi.fn(),
      transaction: {
        advanceToValidation: vi.fn(async () => {
          throw new Error('PROFILE_RESTORE_ACTIVATION_FAILED');
        }),
        prepare: createPreparation(operationId),
        readPreparation: vi.fn(async () => 'prepared' as const),
        readOwnForwardProgress: vi.fn(async () => createJournal(operationId, 'prepared')),
        rollback,
      },
    });

    await expect(service.activate(operationId)).resolves.toBe(
      'relaunching',
    );
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});

function createStagingOwner(operationId: string) {
  const owner = new PreparedProfileRestoreOwner();
  owner.set({ operationId, summary: createSummary(), targetDisposition: 'replaceActiveProfile' });
  return { claimPreparedRestore: (id: string) => owner.claim(id) };
}

function activationFixture() {
  const operationId = randomUUID();
  const relaunchApplication = vi.fn();
  const profileSnapshotClient = createSnapshotClient();
  const stagingService = createStagingOwner(operationId);
  const stopBusinessRuntime = vi.fn(async (_id: string) => undefined);
  const transaction = {
    prepare: createPreparation(operationId),
    readPreparation: vi.fn(async (_id: string, _expected?: Readonly<ProfileRestoreActivationJournal>, _authority?: () => Promise<void>): Promise<'prepared' | 'notPrepared'> => 'prepared'),
    readOwnForwardProgress: vi.fn(async () => createJournal(operationId, 'prepared')),
    advanceToValidation: vi.fn(async () => createJournal(operationId, 'validationStarting')),
    rollback: vi.fn(async () => createJournal(operationId, 'rolledBack')),
  };
  const service = new ProfileRestoreActivationService({
    profileSnapshotClient, stagingService, stopBusinessRuntime, transaction, relaunchApplication,
  });
  return { operationId, profileSnapshotClient, stagingService, stopBusinessRuntime, transaction, service, relaunchApplication };
}

function createSnapshotClient() {
  const endRestoreMaintenance = vi.fn(async (_id: string) => 'normal' as const);
  return {
    beginRestoreMaintenance: vi.fn(async () => 'busy' as const),
    assertRestoreMaintenance: vi.fn(async () => 'busy' as const),
    endRestoreMaintenance,
    invalidateRestoreMaintenance: vi.fn(async () => 'busy' as const),
    retainProfileSnapshotForRecovery: vi.fn(),
    cancelProfileRestoreRetention: vi.fn(async (id: string) => { await endRestoreMaintenance(id); }),
    releaseProfileSnapshot: vi.fn(async () => undefined),
    prepareProfileRestoreSnapshot: vi.fn(async () => ({
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
  phase: 'prepared' | 'rolledBack' | 'validationStarting',
) {
  return {
    formatVersion: 1 as const,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId,
    phase,
    revision: phase === 'prepared' ? 0 : phase === 'validationStarting' ? 9 : 2,
  };
}

function createPreparation(operationId: string, afterCapture?: () => void) {
  return vi.fn(async (_id: string, authority?: () => Promise<void>, capture?: (journal: Readonly<ProfileRestoreActivationJournal>) => void) => {
    await authority?.();
    capture?.(createJournal(operationId, 'prepared'));
    afterCapture?.();
  });
}
