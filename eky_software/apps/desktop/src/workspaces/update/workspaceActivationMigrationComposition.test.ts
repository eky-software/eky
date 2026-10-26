import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceActivationMigrationCoordinatorOptions, WorkspaceActivationMigrationRecoveryReceipt } from './workspaceActivationMigrationCoordinator.js';
import { createWorkspaceActivationMigrationComposition, type WorkspaceActivationMigrationCompositionOptions } from './workspaceActivationMigrationComposition.js';

const boundary = vi.hoisted(() => ({
  coordinator: undefined as WorkspaceActivationMigrationCoordinatorOptions | undefined,
  paths: vi.fn(),
}));
vi.mock('electron', () => ({ utilityProcess: {} }));
vi.mock('../runtime/workspaceCandidateRuntimePaths.js', () => ({ resolveWorkspaceCandidateRuntimePaths: boundary.paths }));
vi.mock('./workspaceActivationMigrationCoordinator.js', () => ({
  WorkspaceActivationMigrationCoordinator: class {
    constructor(options: WorkspaceActivationMigrationCoordinatorOptions) { boundary.coordinator = options; }
  },
}));

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const targetId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const root = resolve('test-data', 'activation-composition');
const noActivation = Object.freeze({ kind: 'noActivation' as const });
const rolledBack: WorkspaceActivationMigrationRecoveryReceipt = Object.freeze({ kind: 'rolledBack', journal: Object.freeze({
  formatVersion: 1, operationId, phase: 'rolledBack', revision: 3, hadActiveDatabase: true, hadActiveDocuments: true,
}) });
const recoveryRequired = { code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED' };

beforeEach(() => {
  boundary.coordinator = undefined;
  boundary.paths.mockReset().mockResolvedValue({ backendRoot: root, migrationsDirectory: root, runnerPath: root });
});

describe('activation composition selector recovery handoff', () => {
  it('requires the named main completion handler before resolving runtime paths', async () => {
    const f = fixture();
    const { completeSelectorRollback: _omitted, ...options } = f.options;
    await expect(createWorkspaceActivationMigrationComposition(options)).rejects.toMatchObject(recoveryRequired);
    expect(boundary.paths).not.toHaveBeenCalled();
    expect(boundary.coordinator).toBeUndefined();
  });

  it('preserves the old source recovery without a selector completion handler', async () => {
    const f = fixture(false);
    const { completeSelectorRollback: _omitted, ...options } = f.options;
    await createWorkspaceActivationMigrationComposition(options);
    await expect(boundary.coordinator!.sourceRecovery.recoverFromFailure()).resolves.toBe('relaunchRequired');
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.recover).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([noActivation, rolledBack])('awaits main completion before source recovery for $kind', async receipt => {
    const f = fixture();
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.complete.mockImplementationOnce(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
    await createWorkspaceActivationMigrationComposition(f.options);
    const work = boundary.coordinator!.sourceRecovery.recoverFromFailure(receipt);
    try { await started; expect(f.recover).not.toHaveBeenCalled(); }
    finally { release(); }
    await expect(work).resolves.toBe('relaunchRequired');
    expect(f.complete).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(f.recover).toHaveBeenCalledExactlyOnceWith();
    await expect(boundary.coordinator!.sourceRecovery.recoverFromFailure(receipt)).rejects.toMatchObject(recoveryRequired);
    expect(f.recover).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'operation', 'phase', 'database'] as const)('rejects %s evidence without main completion', async fault => {
    const f = fixture();
    await createWorkspaceActivationMigrationComposition(f.options);
    const receipt = fault === 'missing' ? undefined : { ...rolledBack, journal: {
      ...rolledBack.journal,
      ...(fault === 'operation' ? { operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } : {}),
      ...(fault === 'phase' ? { phase: 'accepted' as const } : {}),
      ...(fault === 'database' ? { hadActiveDatabase: false } : {}),
    } };
    await expect(boundary.coordinator!.sourceRecovery.recoverFromFailure(receipt)).rejects.toMatchObject(recoveryRequired);
    expect(f.complete).not.toHaveBeenCalled(); expect(f.recover).not.toHaveBeenCalled();
  });

  it('captures the completion and source callbacks before asynchronous preparation', async () => {
    const f = fixture();
    const replacement = vi.fn(async () => undefined);
    boundary.paths.mockImplementationOnce(async () => {
      Object.assign(f.options, { completeSelectorRollback: replacement });
      Object.assign(f.options.activeWorkspace, { recoverFromFailure: replacement });
      return { backendRoot: root, migrationsDirectory: root, runnerPath: root };
    });
    await createWorkspaceActivationMigrationComposition(f.options);
    await expect(boundary.coordinator!.sourceRecovery.recoverFromFailure(noActivation)).resolves.toBe('relaunchRequired');
    expect(f.complete).toHaveBeenCalledOnce(); expect(f.recover).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it('retains the original completion failure and disallows a second invocation', async () => {
    const f = fixture(); const failure = new Error('synthetic cold completion failed');
    f.complete.mockRejectedValueOnce(failure);
    await createWorkspaceActivationMigrationComposition(f.options);
    await expect(boundary.coordinator!.sourceRecovery.recoverFromFailure(rolledBack)).rejects.toBe(failure);
    await expect(boundary.coordinator!.sourceRecovery.recoverFromFailure(rolledBack)).rejects.toMatchObject(recoveryRequired);
    expect(f.complete).toHaveBeenCalledOnce(); expect(f.recover).not.toHaveBeenCalled();
  });

  it.each(['completion', 'source'] as const)('seals both overlapping calls during %s', async stage => {
    const f = fixture();
    await createWorkspaceActivationMigrationComposition(f.options);
    const recover = boundary.coordinator!.sourceRecovery.recoverFromFailure;
    if (stage === 'completion') f.complete.mockImplementationOnce(async () => {
      await expect(recover(noActivation)).rejects.toMatchObject(recoveryRequired);
    });
    else f.recover.mockImplementationOnce(async () => {
      await expect(recover(noActivation)).rejects.toMatchObject(recoveryRequired);
      return 'relaunchRequired';
    });
    await expect(recover(noActivation)).rejects.toMatchObject(recoveryRequired);
    expect(f.complete).toHaveBeenCalledOnce(); expect(f.recover).toHaveBeenCalledTimes(stage === 'completion' ? 0 : 1);
  });
});

function fixture(selector = true) {
  const complete = vi.fn(async (_receipt: WorkspaceActivationMigrationRecoveryReceipt) => undefined);
  const recover = vi.fn(async () => 'relaunchRequired' as const);
  const absentSlots = () => ({ current: undefined, next: undefined, backup: undefined });
  const unexpected = async () => { throw new Error('unexpected runtime work in composition regression'); };
  const options: WorkspaceActivationMigrationCompositionOptions = {
    activeWorkspace: {
      mode: 'targetValidation', workspaceId: targetId, workspaceRoot: root,
      switchContext: { operationId, sourceWorkspaceId: selector ? null : validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
        targetWorkspaceId: targetId, targetProfileId: 'a'.repeat(64) },
      ...(selector ? { selectorActivationAuthority: {
        selection: { registrySlots: absentSlots(), journalSlots: absentSlots(), assertAuthority() {}, async readRegistrySlots() { return absentSlots(); } },
        async readJournalSlots() { return absentSlots(); },
      } } : {}),
      assertCanAccept() {}, accept: unexpected, rejectInvalidTarget: unexpected, requireRecovery: unexpected,
      recoverFromFailure: recover,
    },
    appVersion: '0.2.8', buildRevision: 'a'.repeat(40), completeSelectorRollback: complete,
    maintenanceLease: { acquire: unexpected }, recoveryPointService: { createPreMigration: unexpected },
    recoveryPointStore: { stageForRestore: unexpected }, recoveryPointStagingRoot: root,
    recoveryPointStagingOwner: { removeProfileSnapshot: unexpected }, requestRelaunch() { throw new Error('unexpected relaunch'); },
    resourcesPath: root, userDataRoot: root, assertMainReservationOwned: unexpected,
    reservationOwner: { assertMainOwned: unexpected, bindCandidate() { throw new Error('unexpected candidate'); } },
  };
  return { options, complete, recover };
}
