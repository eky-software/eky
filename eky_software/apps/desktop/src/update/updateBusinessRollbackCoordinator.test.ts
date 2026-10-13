import { describe, expect, it, vi } from 'vitest';

import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { readProfileInspectionFailureCause } from '../runtime/profileInspectionFailure.js';
import {
  UpdateBusinessRollbackCoordinator,
  UpdateBusinessRollbackError,
} from './updateBusinessRollbackCoordinator.js';
import type { UpdateJournal } from './updateJournal.js';
import { createUpdateOperationalObserver } from './updateOperationalObserver.js';

describe('UpdateBusinessRollbackCoordinator', () => {
  it.each(['rollbackRequired', 'businessRollbackStarting', 'businessRollbackCompleted'] as const)(
    'admits only the exact running C target before database opening (%s)', async state => {
      const selected = createJournal(state);
      let current = selected;
      const write = vi.fn();
      const restoreRecoveryPoint = vi.fn();
      const validateActiveProfileForRollback = vi.fn();
      const coordinator = new UpdateBusinessRollbackCoordinator({
        journalStore: { read: vi.fn(), readForLiveOwner: async () => current, write },
        releaseInfo: createReleaseInfo(), profileProtection: { restoreRecoveryPoint, validateActiveProfileForRollback },
      });
      const admission = await coordinator.prepareStartupAdmission({ selectedJournal: selected, assertAuthority() {} });
      expect(admission?.migrationStartupPolicy).toBe('restoreCompatible');
      expect(Object.isFrozen(admission)).toBe(true);
      await expect(admission!.assertCurrent()).resolves.toBeUndefined();
      current = { ...selected, candidatePackageIdentity: { ...selected.candidatePackageIdentity, packageSize: 4_096 } };
      await expect(admission!.assertCurrent()).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
      expect(write).not.toHaveBeenCalled(); expect(restoreRecoveryPoint).not.toHaveBeenCalled();
      expect(validateActiveProfileForRollback).not.toHaveBeenCalled();
    },
  );

  it.each(['version', 'revision', 'chain', 'recoveryPoint'] as const)(
    'rejects insufficient C pre-open authority without mutations (%s)', async change => {
      const selected = { ...createJournal('businessRollbackCompleted'),
        ...(change === 'version' ? { targetVersion: '0.1.0-alpha.3' } : {}),
        ...(change === 'revision' ? { candidatePackageIdentity: { ...createJournal('businessRollbackCompleted').candidatePackageIdentity,
          buildRevision: 'f'.repeat(40) } } : {}),
      };
      if (change === 'chain') delete selected.preUpdateMigrationChainIdentity;
      if (change === 'recoveryPoint') delete selected.recoveryPointReference;
      const write = vi.fn();
      const coordinator = new UpdateBusinessRollbackCoordinator({
        journalStore: { read: vi.fn(), readForLiveOwner: async () => selected, write },
        releaseInfo: createReleaseInfo(), profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback: vi.fn() },
      });
      await expect(coordinator.prepareStartupAdmission({ selectedJournal: selected, assertAuthority() {} })).rejects.toThrow();
      expect(write).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])('never adopts a new pre-open selection (original absent: %s)', async absent => {
    const selected = createJournal('rollbackRequired');
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: vi.fn(), readForLiveOwner: async () => ({ ...selected, revision: selected.revision + 1 }), write: vi.fn() },
      releaseInfo: createReleaseInfo(), profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback: vi.fn() },
    });
    await expect(coordinator.prepareStartupAdmission({ selectedJournal: absent ? undefined : selected,
      assertAuthority() {} })).rejects.toThrow('UPDATE_JOURNAL_CONFLICT');
  });

  it('does not grant restore compatibility to ordinary or terminal startup', async () => {
    let current: Readonly<UpdateJournal> | undefined;
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: vi.fn(), readForLiveOwner: async () => current, write: vi.fn() },
      releaseInfo: createReleaseInfo(), profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback: vi.fn() },
    });
    await expect(coordinator.prepareStartupAdmission({ selectedJournal: undefined, assertAuthority() {} })).resolves.toBeUndefined();
    current = { ...createJournal('businessRollbackCompleted'), state: 'accepted' };
    await expect(coordinator.prepareStartupAdmission({ selectedJournal: current, assertAuthority() {} })).resolves.toBeUndefined();
  });

  it('rechecks authority after each awaited pre-open selection read', async () => {
    const selected = createJournal('businessRollbackStarting');
    let currentAuthority = true;
    let invalidate = false;
    const assertAuthority = () => { if (!currentAuthority) throw new Error('SYNTHETIC_AUTHORITY_EXPIRED'); };
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: vi.fn(), readForLiveOwner: async () => {
        if (invalidate) currentAuthority = false;
        return selected;
      }, write: vi.fn() },
      releaseInfo: createReleaseInfo(), profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback: vi.fn() },
    });
    const admission = await coordinator.prepareStartupAdmission({ selectedJournal: selected, assertAuthority });
    invalidate = true;
    await expect(admission!.assertCurrent()).rejects.toThrow('SYNTHETIC_AUTHORITY_EXPIRED');
  });

  it.each(['operation', 'revision', 'state', 'recoveryPoint', 'package', 'size', 'missing'] as const)(
    'does not adopt a changed initial start selection (%s)', async change => {
      const selected = createJournal('rollbackRequired');
      const current = change === 'missing' ? undefined
        : change === 'operation' ? { ...selected, correlationId: '55555555-5555-4555-8555-555555555555' }
        : change === 'revision' ? { ...selected, revision: selected.revision + 1 }
        : change === 'state' ? createJournal('businessRollbackStarting')
        : change === 'recoveryPoint' ? { ...selected, recoveryPointReference: '55555555-5555-4555-8555-555555555555' }
        : { ...selected, candidatePackageIdentity: { ...selected.candidatePackageIdentity,
          ...(change === 'package' ? { packageSha256: 'f'.repeat(64) } : { packageSize: 4_096 }) } };
      const read = vi.fn(async () => current);
      const write = vi.fn();
      const restoreRecoveryPoint = vi.fn();
      const coordinator = new UpdateBusinessRollbackCoordinator({
        journalStore: { read, readForLiveOwner: async () => current, write },
        releaseInfo: createReleaseInfo(),
        profileProtection: { restoreRecoveryPoint, validateActiveProfileForRollback: createProfileValidation },
      });
      await expect(coordinator.startIfRequired(createInspection(), {
        selectedJournal: selected, assertAuthority() {},
      })).rejects.toThrow();
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(restoreRecoveryPoint).not.toHaveBeenCalled();
    },
  );

  it('does not adopt an operation appearing after an explicitly absent selection', async () => {
    const current = createJournal('rollbackRequired');
    const write = vi.fn();
    const restoreRecoveryPoint = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => current, readForLiveOwner: async () => current, write },
      releaseInfo: createReleaseInfo(),
      profileProtection: { restoreRecoveryPoint, validateActiveProfileForRollback: createProfileValidation },
    });
    await expect(coordinator.startIfRequired(createInspection(), {
      selectedJournal: undefined, assertAuthority() {},
    })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
  });

  it.each(['rollbackRequired', 'businessRollbackStarting', 'businessRollbackCompleted'] as const)(
    'returns only the exact selected start successor (%s)', async state => {
      const selected = createJournal(state);
      let stored = selected;
      const assertAuthority = vi.fn();
      const write = vi.fn(async (next: Readonly<UpdateJournal>) => { stored = next; });
      const coordinator = new UpdateBusinessRollbackCoordinator({
        journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
        releaseInfo: createReleaseInfo(),
        profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback: createProfileValidation },
      });
      const result = await coordinator.startIfRequired(createInspection(), { selectedJournal: selected, assertAuthority });
      expect(result).toEqual({ status: state === 'businessRollbackCompleted' ? 'notRequired' : 'validationRequired',
        selectedJournal: stored });
      expect(Object.isFrozen(result.selectedJournal)).toBe(true);
      expect(Object.isFrozen(result.selectedJournal?.candidatePackageIdentity)).toBe(true);
      if (state === 'rollbackRequired') expect(write).toHaveBeenCalledExactlyOnceWith(
        stored, { expectedJournal: selected, assertAuthority },
      );
      else expect(write).not.toHaveBeenCalled();
    },
  );

  it('retains the original restore failure without publishing over a changed start journal', async () => {
    const selected = createJournal('businessRollbackStarting');
    let stored = selected;
    const changed = { ...selected, candidatePackageIdentity: { ...selected.candidatePackageIdentity, packageSize: 4_096 } };
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const write = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
      releaseInfo: createReleaseInfo(),
      profileProtection: {
        async restoreRecoveryPoint() { stored = changed; throw original; },
        validateActiveProfileForRollback: createProfileValidation,
      },
    });
    const failure = await captureFailure(coordinator.startIfRequired(undefined, {
      selectedJournal: selected, assertAuthority() {},
    }));
    expect(readProfileInspectionFailureCause(failure)).toBe(original.message);
    expect((failure.cause as AggregateError).errors[0]).toBe(original);
    expect(stored).toBe(changed);
    expect(write).not.toHaveBeenCalled();
  });

  it('rechecks caller authority after the awaited start read', async () => {
    const selected = createJournal('rollbackRequired');
    let currentAuthority = true;
    const write = vi.fn();
    const restoreRecoveryPoint = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => selected,
        readForLiveOwner: async () => { currentAuthority = false; return selected; }, write },
      releaseInfo: createReleaseInfo(),
      profileProtection: { restoreRecoveryPoint, validateActiveProfileForRollback: createProfileValidation },
    });
    await expect(coordinator.startIfRequired(createInspection(), { selectedJournal: selected,
      assertAuthority() { if (!currentAuthority) throw new Error('UPDATE_JOURNAL_CONFLICT'); },
    })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
  });

  it.each(['revision', 'package', 'operation'] as const)(
    'retains a changed selection after profile validation (%s)', async change => {
      const selected = createJournal('businessRollbackStarting');
      let stored = selected;
      let changed: Readonly<UpdateJournal> | undefined;
      const write = vi.fn(async (next: Readonly<UpdateJournal>) => { stored = next; });
      const operationCompleted = vi.fn();
      const coordinator = new UpdateBusinessRollbackCoordinator({
        journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
        observer: { operationCompleted, operationFailed: vi.fn(), operationStarted: vi.fn() },
        releaseInfo: createReleaseInfo(),
        profileProtection: {
          restoreRecoveryPoint: vi.fn(),
          async validateActiveProfileForRollback() {
            changed = change === 'revision' ? { ...selected, revision: selected.revision + 1 }
              : change === 'operation' ? { ...selected, correlationId: '55555555-5555-4555-8555-555555555555' }
              : { ...selected, currentPackageIdentity: { ...selected.currentPackageIdentity, packageSha256: 'f'.repeat(64) } };
            stored = changed;
            return createProfileValidation();
          },
        },
      });
      await expect(coordinator.completeAfterProfileValidation({ inspection: createInspection() }))
        .rejects.toThrow('requires recovery');
      expect(stored).toEqual(changed);
      expect(write).not.toHaveBeenCalled();
      expect(operationCompleted).not.toHaveBeenCalled();
    },
  );

  it('preserves the inspection cause without overwriting a changed recovery journal', async () => {
    const selected = createJournal('businessRollbackStarting');
    const changed = { ...selected, revision: selected.revision + 1 };
    let stored = selected;
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const write = vi.fn(async (next: Readonly<UpdateJournal>) => { stored = next; });
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
      releaseInfo: createReleaseInfo(),
      profileProtection: {
        restoreRecoveryPoint: vi.fn(),
        async validateActiveProfileForRollback() { stored = changed; throw original; },
      },
    });
    const failure = await captureFailure(coordinator.completeAfterProfileValidation({ inspection: createInspection() }));
    expect(readProfileInspectionFailureCause(failure)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
    expect(stored).toEqual(changed);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([false, true])('only resumes an unchanged completed selection (changed: %s)', async changed => {
    const selected = createJournal('businessRollbackCompleted');
    let stored = selected;
    const write = vi.fn();
    const operationCompleted = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
      observer: { operationCompleted, operationFailed: vi.fn(), operationStarted: vi.fn() },
      releaseInfo: createReleaseInfo(),
      profileProtection: {
        restoreRecoveryPoint: vi.fn(),
        async validateActiveProfileForRollback() {
          if (changed) stored = { ...selected, updatedAt: '2026-08-12T12:01:00.000Z' };
          return createProfileValidation();
        },
      },
    });
    const completion = coordinator.completeAfterProfileValidation({
      inspection: createInspection(), selectedJournal: selected,
    });
    if (changed) await expect(completion).rejects.toThrow('requires recovery');
    else await expect(completion).resolves.toBeUndefined();
    expect(operationCompleted).toHaveBeenCalledTimes(changed ? 0 : 1);
    expect(write).not.toHaveBeenCalled();
    expect(stored).toEqual(changed
      ? { ...selected, updatedAt: '2026-08-12T12:01:00.000Z' } : selected);
  });

  it('rejects an explicitly selected stale journal before profile validation', async () => {
    const selected = createJournal('businessRollbackStarting');
    const current = { ...selected, revision: selected.revision + 1 };
    const write = vi.fn();
    const validateActiveProfileForRollback = vi.fn(createProfileValidation);
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => current, readForLiveOwner: async () => current, write },
      profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback },
      releaseInfo: createReleaseInfo(),
    });
    await expect(coordinator.completeAfterProfileValidation({
      inspection: createInspection(), selectedJournal: selected,
    })).rejects.toThrow('requires recovery');
    expect(validateActiveProfileForRollback).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([false, true])('passes caller authority to the exact journal write (validation fails: %s)', async validationFails => {
    const selected = createJournal('businessRollbackStarting');
    let stored = selected;
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const assertAuthority = vi.fn();
    const write = vi.fn(async (next: Readonly<UpdateJournal>) => { stored = next; });
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
      releaseInfo: createReleaseInfo(),
      profileProtection: {
        restoreRecoveryPoint: vi.fn(),
        async validateActiveProfileForRollback() {
          if (validationFails) throw original;
          return createProfileValidation();
        },
      },
    });
    const completion = coordinator.completeAfterProfileValidation({
      inspection: createInspection(), selectedJournal: selected, assertAuthority,
    });
    if (validationFails) expect((await captureFailure(completion)).cause).toBe(original);
    else await expect(completion).resolves.toBeUndefined();
    expect(assertAuthority).toHaveBeenCalled();
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      state: validationFails ? 'recoveryRequired' : 'businessRollbackCompleted',
    }), { expectedJournal: selected, assertAuthority });
  });

  it('does not overwrite a published completion after its write reports failure', async () => {
    let stored = createJournal('businessRollbackStarting');
    const original = new Error('synthetic completion persistence failure');
    const write = vi.fn(async (next: Readonly<UpdateJournal>) => {
      stored = next;
      throw original;
    });
    const operationCompleted = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
      profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback: createProfileValidation },
      observer: { operationCompleted, operationFailed: vi.fn(), operationStarted: vi.fn() },
      releaseInfo: createReleaseInfo(),
    });
    const failure = await captureFailure(coordinator.completeAfterProfileValidation({
      inspection: createInspection(),
    }));
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toEqual([
      original, expect.objectContaining({ message: 'UPDATE_JOURNAL_CONFLICT' }),
    ]);
    expect(write).toHaveBeenCalledOnce();
    expect(stored.state).toBe('businessRollbackCompleted');
    expect(stored.revision).toBe(8);
    expect(operationCompleted).not.toHaveBeenCalled();
  });

  it('durably starts one exact business rollback before activation', async () => {
    const journal = createJournal('rollbackRequired');
    let stored: Readonly<UpdateJournal> = journal;
    const order: string[] = [];
    const restoreRecoveryPoint = vi.fn(async () => {
      order.push('restore');
      return 'relaunching' as const;
    });
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => {
          order.push(next.state);
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfileForRollback: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    const result = await coordinator.startIfRequired();
    expect(result).toEqual({ status: 'relaunching', selectedJournal: stored });
    expect(order).toEqual(['businessRollbackStarting', 'restore']);
    expect(restoreRecoveryPoint).toHaveBeenCalledWith({
      expectedMigrationChainIdentity: 'c'.repeat(64),
      operationId: journal.correlationId,
      recoveryPointReference: journal.recoveryPointReference,
      assertAuthority: expect.any(Function),
    });
  });

  it('resumes the same journal correlation without a second transition', async () => {
    const journal = createJournal('businessRollbackStarting');
    const write = vi.fn();
    const restoreRecoveryPoint = vi.fn(async () => 'relaunching' as const);
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => journal, readForLiveOwner: async () => journal, write },
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfileForRollback: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    await coordinator.startIfRequired();

    expect(write).not.toHaveBeenCalled();
    expect(restoreRecoveryPoint).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: journal.correlationId }),
    );
  });

  it('fails safe without activating when the protected identity is incomplete', async () => {
    const {
      preUpdateMigrationChainIdentity: _preUpdateMigrationChainIdentity,
      ...journal
    } = createJournal('rollbackRequired');
    let stored = journal;
    const restoreRecoveryPoint = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfileForRollback: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).rejects.toThrow(
      'requires recovery',
    );
    expect(stored.state).toBe('failedSafe');
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
  });

  it('fails safe when activation cannot establish a recoverable profile', async () => {
    let stored = createJournal('rollbackRequired');
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint: vi.fn(async () => {
          throw new Error('synthetic activation failure');
        }),
        validateActiveProfileForRollback: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired()).rejects.toThrow(
      'requires recovery',
    );
    expect(stored.state).toBe('failedSafe');
  });

  it('validates an already restored exact profile before completing business rollback', async () => {
    let stored = createJournal('businessRollbackStarting');
    const restoreRecoveryPoint = vi.fn();
    const validateActiveProfileForRollback = vi.fn(createProfileValidation);
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint,
        validateActiveProfileForRollback,
      },
      releaseInfo: createReleaseInfo(),
    });
    const inspection = createInspection();

    await expect(
      coordinator.startIfRequired(inspection),
    ).resolves.toMatchObject({ status: 'validationRequired', selectedJournal: stored });
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
    await coordinator.completeAfterProfileValidation({ inspection });

    expect(stored.state).toBe('businessRollbackCompleted');
    expect(validateActiveProfileForRollback).toHaveBeenCalledOnce();
  });

  it('requires recovery when restored profile validation changes the migration chain', async () => {
    let stored = createJournal('businessRollbackStarting');
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      profileProtection: {
        restoreRecoveryPoint: vi.fn(),
        validateActiveProfileForRollback: async () => ({
          ...(await createProfileValidation()),
          migrationChainIdentity: 'd'.repeat(64),
        }),
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      releaseInfo: createReleaseInfo(),
    });

    await expect(
      coordinator.completeAfterProfileValidation({
        inspection: createInspection(),
      }),
    ).rejects.toThrow('requires recovery');
    expect(stored.state).toBe('recoveryRequired');
  });

  it('binds rollback validation to the full selected journal throughout awaited inspection', async () => {
    let stored = createJournal('businessRollbackStarting');
    const selected = stored;
    const assertAuthority = vi.fn();
    const write = vi.fn();
    const validateActiveProfileForRollback = vi.fn(async (context: {
      expectedMigrationChainIdentity: string; assertCurrent(): Promise<void>;
    }) => {
      expect(context.expectedMigrationChainIdentity).toBe(selected.preUpdateMigrationChainIdentity);
      await context.assertCurrent();
      stored = { ...stored, currentPackageIdentity: { ...stored.currentPackageIdentity, packageSize: 8_192 } };
      // Same operation, state and revision: identity comparison must still reject the replacement.
      await context.assertCurrent();
      return createProfileValidation();
    });
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
      releaseInfo: createReleaseInfo(),
      profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback },
    });
    const failure = await captureFailure(coordinator.completeAfterProfileValidation({
      inspection: createInspection(), selectedJournal: selected, assertAuthority,
    }));
    expect(failure).toBeInstanceOf(UpdateBusinessRollbackError);
    expect(write).not.toHaveBeenCalled();
    expect(stored.currentPackageIdentity.packageSize).toBe(8_192);
    expect(assertAuthority).toHaveBeenCalled();
  });

  it('requires recovery after the restore transaction rolls itself back', async () => {
    let stored = createJournal('businessRollbackStarting');
    const validateActiveProfileForRollback = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => {
          stored = next;
        },
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      profileProtection: {
        restoreRecoveryPoint: vi.fn(),
        validateActiveProfileForRollback,
      },
      releaseInfo: createReleaseInfo(),
    });

    await expect(
      coordinator.requireRecoveryAfterRestoreRollback(),
    ).rejects.toThrow('requires recovery');
    expect(stored.state).toBe('recoveryRequired');
    expect(validateActiveProfileForRollback).not.toHaveBeenCalled();
  });

  it.each(
    ['activation', 'validation'].flatMap((phase) =>
      [false, true].flatMap((persistenceFails) =>
        [false, true].map((observerThrows) => ({
          phase, persistenceFails, observerThrows,
        })),
      ),
    ),
  )('preserves the first internal cause with separate journal failure ($phase, persistence fails: $persistenceFails, observer throws: $observerThrows)', async ({
    phase, persistenceFails, observerThrows,
  }) => {
    const original = new Error('PROFILE_SCHEMA_UNSUPPORTED', {
      cause: new Error('synthetic private inspection detail'),
    });
    const persistenceError = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED', {
      cause: new Error('synthetic private journal detail'),
    });
    let stored = createJournal('businessRollbackStarting');
    const events: DesktopOperationalEvent[] = [];
    const expectedState = phase === 'activation' ? 'failedSafe' : 'recoveryRequired';
    const write = vi.fn(async (next: Readonly<UpdateJournal>) => {
      if (persistenceFails) throw persistenceError;
      stored = next;
    });
    const observer = createUpdateOperationalObserver({
      identity: {
        appVersion: createReleaseInfo().appVersion,
        buildRevision: createReleaseInfo().buildRevision,
        runtimeInstanceId: '44444444-4444-4444-8444-444444444444',
      },
      logger: {
        write(event) {
          events.push(event);
          if (observerThrows) throw new Error('synthetic private observer detail');
        },
      },
    });
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: { read: async () => stored, readForLiveOwner: async () => stored, write },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
      observer,
      profileProtection: {
        restoreRecoveryPoint: async () => { throw original; },
        validateActiveProfileForRollback: async () => { throw original; },
      },
      releaseInfo: createReleaseInfo(),
    });

    const failure = await captureFailure(phase === 'activation'
      ? coordinator.startIfRequired()
      : coordinator.completeAfterProfileValidation({ inspection: createInspection() }));

    expect(failure).toBeInstanceOf(UpdateBusinessRollbackError);
    expect(failure.message).toBe('The update business profile rollback requires recovery.');
    expect(readProfileInspectionFailureCause(failure)).toBe('PROFILE_SCHEMA_UNSUPPORTED');
    if (persistenceFails) {
      expect(failure.cause).toBeInstanceOf(AggregateError);
      const causes = (failure.cause as AggregateError).errors;
      expect(causes).toHaveLength(2);
      expect(causes[0]).toBe(original);
      expect(causes[1]).toBe(persistenceError);
      expect(stored.state).toBe('businessRollbackStarting');
    } else {
      expect(failure.cause).toBe(original);
      expect(stored.state).toBe(expectedState);
    }
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      state: expectedState,
    }), expect.objectContaining({
      expectedJournal: expect.objectContaining({ state: 'businessRollbackStarting', revision: 7 }),
    }));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
      eventName: 'update.businessRollbackFailed',
      errorCode: 'UPDATE_BUSINESS_ROLLBACK_FAILED',
    })]));
    expect(events.some((event) => event.eventName === 'update.businessRollbackSucceeded')).toBe(false);
    expect(events.some((event) => event.eventName === 'update.recoveryRequired')).toBe(phase === 'validation');
    expect(JSON.stringify(events)).not.toMatch(/synthetic private|PROFILE_SCHEMA_UNSUPPORTED|PROFILE_INSPECTION_CLEANUP_UNVERIFIED|cause|stack/);
  });

  it('keeps the generic recovery result and internal journal failure after restore rollback', async () => {
    const journal = createJournal('businessRollbackStarting');
    const persistenceError = new Error('synthetic private recovery journal failure');
    const operationFailed = vi.fn();
    const operationStateChanged = vi.fn();
    const validateActiveProfileForRollback = vi.fn();
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => journal,
        readForLiveOwner: async () => journal,
        write: async () => { throw persistenceError; },
      },
      observer: {
        operationCompleted: vi.fn(), operationStarted: vi.fn(),
        operationFailed, operationStateChanged,
      },
      profileProtection: { restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback },
      releaseInfo: createReleaseInfo(),
    });

    const failure = await captureFailure(coordinator.requireRecoveryAfterRestoreRollback());

    expect(failure).toBeInstanceOf(UpdateBusinessRollbackError);
    expect(failure.cause).toBe(persistenceError);
    expect(failure.message).toBe('The update business profile rollback requires recovery.');
    expect(operationFailed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      errorCode: 'UPDATE_BUSINESS_ROLLBACK_FAILED',
    }));
    expect(operationStateChanged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      state: 'recoveryRequired',
    }));
    expect(validateActiveProfileForRollback).not.toHaveBeenCalled();
    expect(journal.state).toBe('businessRollbackStarting');
  });

  it.each([false, true])('preserves an unclassified completion-journal failure before any recovery-journal failure (%s)', async (recoveryWriteFails) => {
    const original = new Error('synthetic private completion journal failure');
    const recoveryError = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    let stored = createJournal('businessRollbackStarting');
    const operationCompleted = vi.fn();
    const operationFailed = vi.fn();
    const writes: string[] = [];
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => {
          writes.push(next.state);
          if (next.state === 'businessRollbackCompleted') throw original;
          if (recoveryWriteFails) throw recoveryError;
          stored = next;
        },
      },
      observer: { operationCompleted, operationFailed, operationStarted: vi.fn() },
      profileProtection: {
        restoreRecoveryPoint: vi.fn(), validateActiveProfileForRollback: createProfileValidation,
      },
      releaseInfo: createReleaseInfo(),
    });

    const failure = await captureFailure(coordinator.completeAfterProfileValidation({
      inspection: createInspection(),
    }));

    expect(failure).toBeInstanceOf(UpdateBusinessRollbackError);
    expect(readProfileInspectionFailureCause(failure)).toBeUndefined();
    if (recoveryWriteFails) {
      expect(failure.cause).toBeInstanceOf(AggregateError);
      const causes = (failure.cause as AggregateError).errors;
      expect(causes).toHaveLength(2);
      expect(causes[0]).toBe(original);
      expect(causes[1]).toBe(recoveryError);
      expect(stored.state).toBe('businessRollbackStarting');
    } else {
      expect(failure.cause).toBe(original);
      expect(stored.state).toBe('recoveryRequired');
    }
    expect(writes).toEqual(['businessRollbackCompleted', 'recoveryRequired']);
    expect(operationCompleted).not.toHaveBeenCalled();
    expect(operationFailed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      errorCode: 'UPDATE_BUSINESS_ROLLBACK_FAILED',
    }));
  });

  it('keeps successful validation durable when every observer callback throws', async () => {
    let stored = createJournal('businessRollbackStarting');
    const restoreRecoveryPoint = vi.fn();
    const throwObserverFailure = vi.fn(() => { throw new Error('synthetic private observer failure'); });
    const coordinator = new UpdateBusinessRollbackCoordinator({
      journalStore: {
        read: async () => stored,
        readForLiveOwner: async () => stored,
        write: async (next) => { stored = next; },
      },
      observer: {
        operationStarted: throwObserverFailure,
        operationCompleted: throwObserverFailure,
        operationFailed: throwObserverFailure,
        operationStateChanged: throwObserverFailure,
      },
      profileProtection: { restoreRecoveryPoint, validateActiveProfileForRollback: createProfileValidation },
      releaseInfo: createReleaseInfo(),
    });

    await expect(coordinator.startIfRequired(createInspection())).resolves.toMatchObject({ status: 'validationRequired', selectedJournal: stored });
    await expect(coordinator.completeAfterProfileValidation({ inspection: createInspection() })).resolves.toBeUndefined();

    expect(stored.state).toBe('businessRollbackCompleted');
    expect(throwObserverFailure).toHaveBeenCalledTimes(2);
    expect(restoreRecoveryPoint).not.toHaveBeenCalled();
  });
});

async function captureFailure(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('Expected the operation to fail.');
}

function createInspection() {
  return {
    appliedMigrationCount: 37,
    migrationChainIdentity: 'c'.repeat(64),
    pendingMigrationCount: 1,
    profileState: 'existing' as const,
  };
}

async function createProfileValidation() {
  return {
    artifactCount: 2,
    artifactTotalByteSize: 4_096,
    databaseHealth: 'healthy' as const,
    migrationChainIdentity: 'c'.repeat(64),
  };
}

function createJournal(
  state: 'businessRollbackStarting' | 'businessRollbackCompleted' | 'rollbackRequired',
): Readonly<UpdateJournal> {
  return {
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: {
      buildRevision: 'b'.repeat(40),
      msiProductVersion: '0.1.2',
      packageSha256: '2'.repeat(64),
      packageSize: 2_048,
    },
    correlationId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-08-12T10:00:00.000Z',
    currentPackageIdentity: {
      buildRevision: 'a'.repeat(40),
      msiProductVersion: '0.1.1',
      packageSha256: '1'.repeat(64),
      packageSize: 1_024,
    },
    currentVersion: '0.1.0-alpha.1',
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    releaseChannel: 'pilot',
    revision: state === 'rollbackRequired' ? 6 : 7,
    state,
    targetVersion: '0.1.0-alpha.2',
    updatedAt: '2026-08-12T11:00:00.000Z',
  };
}

function createReleaseInfo() {
  return {
    appIdentity: 'Eky' as const,
    appVersion: '0.1.0-alpha.2',
    architecture: 'x64' as const,
    buildRevision: 'b'.repeat(40),
    msiProductVersion: '0.1.2',
    platform: 'win32' as const,
    releaseChannel: 'pilot' as const,
    schemaVersion: 1 as const,
    upgradeCode: '33333333-3333-4333-8333-333333333333'.toUpperCase(),
  };
}
