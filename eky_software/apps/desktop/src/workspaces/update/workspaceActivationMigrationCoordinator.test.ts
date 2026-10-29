import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationTransaction } from '../../profileBackup/restore/profileRestoreActivationTransaction.js';
import type { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deriveWorkspaceBackupReplacementPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../replacement/workspaceBackupReplacementRootStore.js';
import { WorkspaceActivationMigrationCoordinator, type WorkspaceActivationMigrationCoordinatorOptions,
  type WorkspaceActivationMigrationRecoveryReceipt } from './workspaceActivationMigrationCoordinator.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import type { WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';

const operationId = validateWorkspaceBackupImportOperationId(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);
const sourceWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const targetWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const profileId = 'a'.repeat(64);
const sourceMigrationChainIdentity = 'b'.repeat(64);
const targetMigrationChainIdentity = 'c'.repeat(64);
const testUserDataRoot = resolve(
  'test-data',
  'workspace-activation-migration',
);
const cleanupRoots: string[] = [];

afterEach(async ({ task }) => {
  if (task.result?.state !== 'pass') { cleanupRoots.splice(0); return; }
  for (const root of cleanupRoots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe('WorkspaceActivationMigrationCoordinator', () => {
  it('captures the complete binding before the first leased read and keeps captured callbacks', async () => {
    const f = createFixture();
    const entered = gate();
    const reading = gate();
    const readback = f.binding.assertPublished;
    const readOwner = f.binding.assertReadOwnership;
    f.activation.journalStore.peek.mockImplementationOnce(async () => {
      entered.resolve(); await reading.promise; return undefined;
    });
    const task = f.coordinator.migrateAndActivate(f.input);
    try {
      await Promise.race([entered.promise, task.then(() => { throw new Error('READ_NOT_REACHED'); })]);
      expect(f.createBinding).toHaveBeenCalledOnce();
      expect(f.createBinding.mock.calls[0]?.[0].proof).toBe(f.input.proof);
      expect(f.createBinding.mock.calls[0]?.[0].lease).toEqual({ release: expect.any(Function) });
      f.binding.assertPublished = vi.fn(async () => { throw new Error('LATE_CALLBACK'); });
      f.binding.assertReadOwnership = vi.fn(async () => { throw new Error('LATE_READ_OWNER'); });
    } finally { reading.resolve(); await task; }
    expect(readback).toHaveBeenCalled();
    expect(f.binding.assertPublished).not.toHaveBeenCalled();
    expect(f.activation.transaction.prepare).toHaveBeenCalledWith(operationId,
      expect.any(Function), expect.any(Function), expect.any(Function));
    expect(f.activation.transaction.advanceToValidation).toHaveBeenCalledWith(createActivationJournal(operationId, 'prepared'),
      expect.any(Function), undefined, expect.objectContaining({
        assertReadOwnership: expect.any(Function), assertMutationCurrent: expect.any(Function),
      }), expect.any(Function));
    const context = f.activation.transaction.advanceToValidation.mock.calls[0]![3]!;
    await expect(context.assertReadOwnership()).rejects.toThrow('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
    expect(readOwner).not.toHaveBeenCalled();
    expect(f.binding.assertReadOwnership).not.toHaveBeenCalled();
  });

  it('uses the captured read owner and seals continuation on its failure', async () => {
    const f = createFixture();
    const primary = new Error('SYNTHETIC_READ_OWNER_LOST');
    const original = f.binding.assertReadOwnership;
    original.mockRejectedValueOnce(primary);
    f.activation.transaction.advanceToValidation.mockImplementationOnce(async (_journal, _full, _content, context) => {
      f.binding.assertReadOwnership = vi.fn(async () => {});
      await context!.assertReadOwnership();
      return createActivationJournal(operationId, 'validationStarting');
    });
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({ cause: primary });
    expect(original).toHaveBeenCalledOnce();
    expect(f.binding.assertReadOwnership).not.toHaveBeenCalled();
    expect(f.blockContinuation).toHaveBeenCalledOnce();
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it('joins a failed publication and retains first, notification and release failures', async () => {
    const f = createFixture({ failLeaseRelease: true });
    const primary = new Error('SYNTHETIC_PUBLICATION_FAILED');
    const notification = new Error('SYNTHETIC_BLOCK_FAILED');
    const entered = gate();
    const publishing = gate();
    f.binding.publishBeforeSnapshot.mockImplementationOnce(async () => {
      entered.resolve(); await publishing.promise; throw primary;
    });
    f.blockContinuation.mockImplementationOnce(() => { throw notification; });
    const task = f.coordinator.migrateAndActivate(f.input).catch((error: unknown) => error);
    try {
      await Promise.race([entered.promise, task.then(() => { throw new Error('PUBLICATION_NOT_REACHED'); })]);
      expect(f.events).not.toContain('lease.release');
    } finally { publishing.resolve(); await task; }
    expect(await task).toMatchObject({ cause: { errors: [
      { cause: { errors: [primary, notification] } }, { message: 'release-failed' },
    ] } });
    expect(f.stopTargetStartupRuntime).not.toHaveBeenCalled();
    expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it('rejects an incomplete binding before reading or publishing', async () => {
    const f = createFixture();
    f.createBinding.mockReturnValueOnce({ publishBeforeSnapshot: f.binding.publishBeforeSnapshot } as never);
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
    expect(f.activation.journalStore.peek).not.toHaveBeenCalled();
    expect(f.binding.publishBeforeSnapshot).not.toHaveBeenCalled();
    expect(f.blockContinuation).toHaveBeenCalledOnce();
    expect(f.events.at(-1)).toBe('lease.release');
  });

  it('does not reuse or mark the old selection after non-null source handoff and relaunch failure', async () => {
    const f = createFixture({ failCandidateMigration: true });
    const relaunch = new Error('SYNTHETIC_RELAUNCH_FAILED');
    let readbacksAtHandoff = 0;
    f.sourceRecovery.recoverFromFailure.mockImplementationOnce(async () => {
      readbacksAtHandoff = f.binding.assertPublished.mock.calls.length;
      return 'relaunchRequired';
    });
    f.requestRelaunch.mockImplementationOnce(() => { throw relaunch; });
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      cause: { errors: [{ message: 'migration-failed' }, relaunch] },
    });
    expect(f.binding.assertPublished).toHaveBeenCalledTimes(readbacksAtHandoff);
    expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(f.blockContinuation).toHaveBeenCalledOnce();
  });

  it('retains the migration, relaunch and continuation-block failures after source handoff', async () => {
    const f = createFixture({ failCandidateMigration: true });
    const relaunch = new Error('SYNTHETIC_RELAUNCH_FAILED');
    const notification = new Error('SYNTHETIC_BLOCK_FAILED');
    f.requestRelaunch.mockImplementationOnce(() => { throw relaunch; });
    f.blockContinuation.mockImplementationOnce(() => { throw notification; });

    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      cause: { errors: [
        { errors: [{ message: 'migration-failed' }, relaunch] }, notification,
      ] },
    });
    expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(f.sourceRecovery.recoverFromFailure).toHaveBeenCalledOnce();
    expect(f.requestRelaunch).toHaveBeenCalledOnce();
    expect(f.blockContinuation).toHaveBeenCalledOnce();
  });

  it('migrates only the private candidate before the activation swap', async () => {
    const fixture = createFixture();

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.events).toEqual([
      'lease.acquire',
      'activation.peek',
      'recovery.createAndStage',
      'runtime.stop',
      'runtime.absent',
      'candidate.prepareRoot',
      'candidate.migrate',
      'candidate.validate',
      'recovery.removeStaging',
      'candidate.inspect',
      'activation.prepare',
      'activation.advance',
      'lease.release',
      'runtime.relaunch',
    ]);
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(fixture.activation.transaction.rollback).not.toHaveBeenCalled();
  });

  it('leaves the published target unswapped and restores the source when preMigration fails', async () => {
    const fixture = createFixture({ failRecoveryPoint: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.activation.transaction.prepare).not.toHaveBeenCalled();
    expect(fixture.activation.transaction.rollback).not.toHaveBeenCalled();
    expect(fixture.rootStore.discardBeforeActivation).toHaveBeenCalledOnce();
    expect(fixture.events).toContain('runtime.stop');
    expect(fixture.events.indexOf('source.recover')).toBeGreaterThan(
      fixture.events.indexOf('candidate.discard'),
    );
  });

  it('discards a partial candidate before selecting the source after migration failure', async () => {
    const fixture = createFixture({ failCandidateMigration: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.activation.transaction.prepare).not.toHaveBeenCalled();
    expect(fixture.events.indexOf('candidate.discard')).toBeGreaterThan(
      fixture.events.indexOf('candidate.migrate'),
    );
    expect(fixture.events.indexOf('source.recover')).toBeGreaterThan(
      fixture.events.indexOf('candidate.discard'),
    );
  });

  it('retains recovery staging and requires recovery when inspection cleanup is unresolved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-activation-preservation-'));
    cleanupRoots.push(root);
    const paths = deriveWorkspaceBackupReplacementPaths(
      root,
      validateWorkspaceBackupReplacementOperationId(operationId),
      targetWorkspaceId,
    );
    await mkdir(dirname(paths.activeDatabasePath), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(paths.activeArtifactRoot, { recursive: true, mode: 0o700 });
    await writeFile(paths.activeDatabasePath, 'unchanged target database');
    const stagedRoot = join(root, 'recovery', 'staged');
    const sourcePath = join(stagedRoot, 'profile.sqlite');
    await mkdir(stagedRoot, { recursive: true, mode: 0o700 });
    await writeFile(sourcePath, 'original recovery snapshot');
    const inspectionRoot = join(
      paths.activationStagingOperationRoot,
      'inspection-unresolved',
    );
    const inspectionPath = join(inspectionRoot, 'inspection.sqlite');
    const fixture = createFixture({
      failCandidateMigration: true,
      userDataRoot: root,
    });
    const store = new NodeWorkspaceBackupReplacementRootStore();
    fixture.rootStore.prepareCandidate.mockImplementation(async () => {
      fixture.events.push('candidate.prepareRoot');
      await store.prepareCandidate(paths);
      await writeFile(paths.candidateDatabasePath, 'unpublished candidate');
      await mkdir(inspectionRoot, { mode: 0o700 });
      await writeFile(inspectionPath, 'unresolved inspection copy');
    });
    fixture.rootStore.discardBeforeActivation.mockImplementation(async () => {
      fixture.events.push('candidate.discard');
      await store.discardBeforeActivation(paths);
    });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.rootStore.discardBeforeActivation).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.requireRecovery).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(fixture.requestRelaunch).not.toHaveBeenCalled();
    expect(fixture.activation.transaction.prepare).not.toHaveBeenCalled();
    expect(fixture.events).not.toContain('recovery.removeStaging');
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(
      'original recovery snapshot',
    );
    await expect(readFile(paths.candidateDatabasePath, 'utf8')).resolves.toBe(
      'unpublished candidate',
    );
    await expect(readFile(inspectionPath, 'utf8')).resolves.toBe(
      'unresolved inspection copy',
    );
    await expect(readFile(paths.activeDatabasePath, 'utf8')).resolves.toBe(
      'unchanged target database',
    );
  });

  it('rolls the target bytes back before recovering the source after swap failure', async () => {
    const fixture = createFixture({ failActivationAdvance: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.events.indexOf('activation.rollback')).toBeGreaterThan(
      fixture.events.indexOf('activation.advance'),
    );
    expect(fixture.events.indexOf('source.recover')).toBeGreaterThan(
      fixture.events.indexOf('activation.rollback'),
    );
    expect(fixture.rootStore.discardBeforeActivation).not.toHaveBeenCalled();
  });

  it('fails closed when the activation journal belongs to another operation', async () => {
    const fixture = createFixture({ foreignActivationJournal: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(fixture.blockContinuation).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(fixture.requestRelaunch).not.toHaveBeenCalled();
  });

  it('does not retry an ambiguous target runtime stop', async () => {
    const fixture = createFixture({ failRuntimeStop: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.stopTargetStartupRuntime).toHaveBeenCalledOnce();
    expect(fixture.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(fixture.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
  });

  it('does not report success when the maintenance lease cannot be released', async () => {
    const fixture = createFixture({ failLeaseRelease: true });

    await expect(
      fixture.coordinator.migrateAndActivate(fixture.input),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(fixture.requestRelaunch).not.toHaveBeenCalled();
  });

  it.each([{ failCandidateMigration: true }, { failActivationAdvance: true }])(
    'hands selector rollback from the switch owner to a real restore owner %#', async failure => {
      const lease = new InMemoryWorkspaceMaintenanceLease();
      const f = createFixture({ ...failure, selector: true, maintenanceLease: lease });
      f.sourceRecovery.recoverFromFailure.mockImplementation(async () => {
        const terminal = await lease.acquire('restore');
        try {
          lease.captureCurrentOwner(['restore'])();
          f.events.push('source.recover');
          return 'relaunchRequired';
        } finally { await terminal.release(); }
      });

      await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
      const release = f.events.indexOf('lease.release');
      expect(f.events.slice(release)).toEqual([
        'lease.release', 'guard.reprove', 'runtime.absent', 'guard.reprove', 'source.recover', 'runtime.relaunch',
      ]);
      expect(release).toBeGreaterThan(f.events.indexOf(failure.failActivationAdvance
        ? 'activation.rollback' : 'candidate.discard'));
      expect(lease.readState()).toBe('idle');
    },
  );

  it('keeps non-null source recovery under its original switch owner', async () => {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    const f = createFixture({ failCandidateMigration: true, maintenanceLease: lease });
    f.sourceRecovery.recoverFromFailure.mockImplementation(async () => {
      lease.captureCurrentOwner(['switch'])();
      f.events.push('source.recover');
      return 'relaunchRequired';
    });
    await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
    expect(f.events.indexOf('source.recover')).toBeLessThan(f.events.indexOf('lease.release'));
    expect(lease.readState()).toBe('idle');
  });

  it('does not return to the selector before lease release has settled', async () => {
    let release!: () => void;
    let releasing!: () => void;
    const started = new Promise<void>(resolve => { releasing = resolve; });
    const f = createFixture({ selector: true, failCandidateMigration: true, maintenanceLease: {
      async acquire() { return { async release() {
        releasing(); await new Promise<void>(resolve => { release = resolve; });
      } }; },
    } });
    const result = f.coordinator.migrateAndActivate(f.input);
    try {
      await Promise.race([started, result.then(() => { throw new Error('RELEASE_NOT_REACHED'); })]);
      expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
      expect(f.requestRelaunch).not.toHaveBeenCalled();
    } finally { release?.(); await result; }
    await expect(result).resolves.toBe('relaunchRequired');
  });

  it('preserves the first activation failure when selector handoff release fails', async () => {
    const f = createFixture({ selector: true, failCandidateMigration: true, failLeaseRelease: true });
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      cause: { errors: [expect.objectContaining({ message: 'migration-failed' }),
        expect.objectContaining({ message: 'release-failed' })] },
    });
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it.each(['lease.release', 'runtime.absent'])(
    'rejects selector authority lost at the post-rollback %s boundary', async expireAt => {
      const f = createFixture({ selector: true, failCandidateMigration: true, expireAt,
        ...(expireAt === 'runtime.absent' ? { expireOccurrence: 3 } : {}) });
      await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
        code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      });
      expect(f.events.indexOf('selector.expired')).toBeGreaterThan(f.events.indexOf('candidate.discard'));
      expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
      expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
      expect(f.requestRelaunch).not.toHaveBeenCalled();
    },
  );

  it('rejects physical ownership lost after switch release before selector recovery', async () => {
    const f = createFixture({ selector: true, failCandidateMigration: true });
    f.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime.mockImplementation(async () => {
      f.events.push('runtime.absent');
      if (f.events.includes('lease.release')) throw new Error('synthetic reservation lost');
    });
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      cause: { errors: [expect.objectContaining({ message: 'migration-failed' }),
        expect.objectContaining({ message: 'synthetic reservation lost' })] },
    });
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it('retains selector recovery failure after release without relaunching', async () => {
    const f = createFixture({ selector: true, failCandidateMigration: true });
    const failure = new Error('synthetic original content failure');
    f.sourceRecovery.recoverFromFailure.mockRejectedValueOnce(failure);
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      cause: { errors: [expect.objectContaining({ message: 'migration-failed' }), failure] },
    });
    expect(f.sourceRecovery.recoverFromFailure).toHaveBeenCalledOnce();
    expect(f.sourceRecovery.requireRecovery).toHaveBeenCalledOnce();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it.each([false, true])('distinguishes no candidate activation from legacy recovery (selector: %s)', async selector => {
    const f = createFixture({ selector, failCandidateMigration: true });
    await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
    expect(f.sourceRecovery.recoverFromFailure.mock.calls).toEqual(selector ? [[{ kind: 'noActivation' }]] : [[]]);
  });

  it('carries the exact frozen rollback writer receipt after lease release without another journal read', async () => {
    const written = { ...createActivationJournal(operationId, 'rolledBack'), revision: 2 };
    const f = createFixture({ selector: true, failActivationAdvance: true,
      onRelease() { written.revision = 99; written.hadActiveDocuments = false; } });
    f.activation.transaction.rollback.mockImplementationOnce(async selected => {
      expect(selected).toEqual(createActivationJournal(operationId, 'prepared'));
      expect(Object.isFrozen(selected)).toBe(true);
      return written;
    });
    await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
    const receipt = f.sourceRecovery.recoverFromFailure.mock.calls[0]?.[0];
    expect(receipt).toEqual({ kind: 'rolledBack', journal: { ...createActivationJournal(operationId, 'rolledBack'), revision: 2 } });
    expect(Object.isFrozen(receipt)).toBe(true);
    if (receipt?.kind === 'rolledBack') expect(Object.isFrozen(receipt.journal)).toBe(true);
    expect(f.activation.journalStore.read).toHaveBeenCalledTimes(1);
    expect(f.activation.journalStore.peek).toHaveBeenCalledTimes(2);
    expect(f.events.indexOf('source.recover')).toBeGreaterThan(f.events.indexOf('lease.release'));
  });

  it.each(['operation', 'phase', 'revision', 'database', 'documents'] as const)(
    'refuses a conflicting rollback %s receipt without source recovery', async mismatch => {
      const f = createFixture({ selector: true, failActivationAdvance: true });
      f.activation.transaction.rollback.mockResolvedValueOnce({
        ...createActivationJournal(operationId, 'rolledBack'), revision: mismatch === 'revision' ? 4 : 2,
        ...(mismatch === 'operation' ? { operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } : {}),
        ...(mismatch === 'phase' ? { phase: 'rollbackStarting' as const } : {}),
        ...(mismatch === 'database' ? { hadActiveDatabase: false } : {}),
        ...(mismatch === 'documents' ? { hadActiveDocuments: false } : {}),
      });
      await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
        code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        cause: { errors: [expect.objectContaining({ message: 'swap-failed' }), expect.any(Error)] },
      });
      expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
      expect(f.requestRelaunch).not.toHaveBeenCalled();
    },
  );

  it.each(['rollbackStarting', 'rolledBack'] as const)('carries a resumed %s writer receipt at its exact revision', async phase => {
    const f = createFixture({ selector: true, failActivationAdvance: true });
    const selected = { ...createActivationJournal(operationId, phase), revision: 7 };
    f.activation.journalStore.peek.mockResolvedValueOnce(undefined).mockResolvedValueOnce(selected);
    f.activation.journalStore.read.mockResolvedValueOnce(selected);
    const written = { ...selected, phase: 'rolledBack' as const, revision: phase === 'rolledBack' ? 7 : 8 };
    f.activation.transaction.rollback.mockResolvedValueOnce(written);
    await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
    expect(f.activation.transaction.rollback).toHaveBeenCalledExactlyOnceWith(selected, expect.any(Function), undefined, expect.any(Function));
    expect(f.sourceRecovery.recoverFromFailure).toHaveBeenCalledExactlyOnceWith({ kind: 'rolledBack', journal: written });
  });

  it('does not turn a lost rollback reply into no activation', async () => {
    const f = createFixture({ selector: true, failActivationAdvance: true });
    const lostReply = new Error('synthetic lost rollback reply');
    f.activation.transaction.rollback.mockRejectedValueOnce(lostReply);
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      cause: { errors: [expect.objectContaining({ message: 'swap-failed' }), lostReply] },
    });
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it('preserves a journal that never contained an original database', async () => {
    const f = createFixture({ selector: true, failActivationAdvance: true });
    const selected = {
      ...createActivationJournal(operationId, 'prepared'), hadActiveDatabase: false,
    };
    f.activation.journalStore.peek.mockResolvedValueOnce(undefined).mockResolvedValueOnce(selected);
    f.activation.journalStore.read.mockResolvedValueOnce(selected);
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
    expect(f.activation.transaction.rollback).not.toHaveBeenCalled();
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it('preserves activation and recovery failures when recovery marking loses authority', async () => {
    const f = createFixture({ selector: true, failActivationAdvance: true, expireAt: 'activation.rollback' });
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      cause: { errors: [
        expect.objectContaining({ message: 'swap-failed' }),
        expect.objectContaining({ code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED' }),
      ] },
    });
    expect(f.events.slice(f.events.indexOf('selector.expired') + 1)).toEqual(['guard.reprove', 'continuation.block', 'lease.release']);
    expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it.each([
    { expireAt: 'lease.acquire' }, { expireAt: 'activation.peek' },
    { expireAt: 'recovery.createAndStage' }, { expireAt: 'candidate.prepareRoot' },
    { expireAt: 'candidate.migrate' }, { expireAt: 'candidate.validate' },
    { expireAt: 'recovery.removeStaging' }, { expireAt: 'candidate.inspect' },
    { expireAt: 'activation.prepare' }, { expireAt: 'activation.advance' },
    { expireAt: 'activation.peek', expireOccurrence: 2, failCandidateMigration: true },
    { expireAt: 'activation.read', failActivationAdvance: true },
    { expireAt: 'candidate.discard', failCandidateMigration: true },
    { expireAt: 'activation.rollback', failActivationAdvance: true },
    { expireAt: 'recovery.removeStaging', failCandidateMigration: true },
  ])('stops selector mutations after authority expires at $expireAt ($expireOccurrence)', async scenario => {
    const f = createFixture({ ...scenario, selector: true });
    await expect(f.coordinator.migrateAndActivate(f.input)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
    const expiry = f.events.indexOf('selector.expired');
    expect(expiry).toBeGreaterThan(-1);
    expect(f.events.slice(expiry + 1).every(event =>
      ['guard.reprove', 'runtime.stop', 'runtime.absent', 'continuation.block', 'lease.release'].includes(event))).toBe(true);
    expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
    expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    expect(f.requestRelaunch).not.toHaveBeenCalled();
  });

  it.each([
    {}, { failCandidateMigration: true }, { failActivationAdvance: true },
    { failCandidateMigration: true, expireAt: 'source.recover' },
  ])(
    'preserves successful selector activation or owned recovery %#', async failure => {
      const f = createFixture({ ...failure, selector: true });
      await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
      expect(f.requestRelaunch).toHaveBeenCalledOnce();
      expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
    },
  );
});

interface FixtureOptions {
  readonly failActivationAdvance?: boolean;
  readonly failCandidateMigration?: boolean;
  readonly failLeaseRelease?: boolean;
  readonly failRecoveryPoint?: boolean;
  readonly failRuntimeStop?: boolean;
  readonly foreignActivationJournal?: boolean;
  readonly userDataRoot?: string;
  readonly selector?: boolean;
  readonly expireAt?: string;
  readonly expireOccurrence?: number;
  readonly maintenanceLease?: WorkspaceMaintenanceLease;
  readonly onRelease?: () => void;
}

function createFixture(options: FixtureOptions = {}) {
  const userDataRoot = options.userDataRoot ?? testUserDataRoot;
  const events: string[] = [];
  let selectorCurrent = true;
  let expiryOccurrences = 0;
  const record = (event: string) => {
    events.push(event);
    if (event === options.expireAt && ++expiryOccurrences === (options.expireOccurrence ?? 1)) {
      selectorCurrent = false;
      events.push('selector.expired');
    }
  };
  let activationJournal: ProfileRestoreActivationJournal | undefined =
    options.foreignActivationJournal
      ? createActivationJournal(
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'prepared',
        )
      : undefined;
  const proof: WorkspaceActivationMigrationProof = Object.freeze({
    operationId,
    profileId,
    registrySnapshot: new Uint8Array([1]),
    sourceWorkspaceId: options.selector ? null : sourceWorkspaceId,
    switchJournalSnapshot: new Uint8Array([2]),
    targetWorkspaceId,
  });
  const requestRelaunch = vi.fn(() => record('runtime.relaunch'));
  const blockContinuation = vi.fn(() => record('continuation.block'));
  let published = false;
  let stopped = false;
  const binding = {
    publishBeforeSnapshot: vi.fn(async () => { published = true; }),
    assertPublished: vi.fn(async () => { if (!published) throw new Error('BINDING_NOT_PUBLISHED'); }),
    assertReadOwnership: vi.fn(async () => { if (!published) throw new Error('BINDING_NOT_PUBLISHED'); }),
    enterStopped: vi.fn(async () => { stopped = true; }),
    assertMutationCurrent: vi.fn(() => { if (!stopped) throw new Error('TARGET_NOT_STOPPED'); }),
    assertSnapshotCleanupCurrent: vi.fn(() => { if (!published) throw new Error('BINDING_NOT_PUBLISHED'); }),
  };
  const createBinding = vi.fn<WorkspaceActivationMigrationCoordinatorOptions['createBinding']>(() => binding);
  const stopTargetStartupRuntime = vi.fn(async () => {
    record('runtime.stop');
    if (options.failRuntimeStop) throw new Error('stop-failed');
  });
  const sourceRecovery = {
    recoverFromFailure: vi.fn(async (_candidate?: WorkspaceActivationMigrationRecoveryReceipt) => {
      record('source.recover');
      return 'relaunchRequired' as const;
    }),
    requireRecovery: vi.fn(async () => {
      record('source.requireRecovery');
      return 'recoveryRequired' as const;
    }),
  };
  const activation = {
    journalStore: {
      peek: vi.fn(async () => { record('activation.peek'); return activationJournal; }),
      read: vi.fn<ProfileRestoreActivationJournalStore['read']>(async () => {
        record('activation.read');
        return activationJournal;
      }),
    },
    transaction: {
      assertForwardRecoveryState: vi.fn(async () => {
        throw new Error('SYNTHETIC_MIGRATION_HAS_NO_COLD_AUTHORITY');
      }),
      readForwardRecoverySources: vi.fn(async () => {
        throw new Error('SYNTHETIC_MIGRATION_HAS_NO_COLD_AUTHORITY');
      }),
      accept: vi.fn(async () => undefined),
      advanceToValidation: vi.fn<ProfileRestoreActivationTransaction['advanceToValidation']>(async () => {
        record('activation.advance');
        if (options.failActivationAdvance) {
          throw new Error('swap-failed');
        }
        activationJournal = createActivationJournal(
          operationId,
          'validationStarting',
        );
        return activationJournal;
      }),
      clearRolledBack: vi.fn(async () => undefined),
      prepare: vi.fn<ProfileRestoreActivationTransaction['prepare']>(async (_operationId, _assertCurrent, capture) => {
        record('activation.prepare');
        activationJournal = createActivationJournal(
          operationId,
          'prepared',
        );
        capture?.(activationJournal);
      }),
      commitAcceptance: vi.fn(async () => { throw new Error('UNEXPECTED_ACCEPTANCE_PUBLICATION'); }),
      clearAccepted: vi.fn(async () => { throw new Error('UNEXPECTED_ACCEPTED_CLEANUP'); }),
      rollback: vi.fn<ProfileRestoreActivationTransaction['rollback']>(async selected => {
        record('activation.rollback');
        activationJournal = createActivationJournal(
          operationId,
          'rolledBack',
        );
        if (selected !== undefined) activationJournal.revision = selected.revision +
          (selected.phase === 'rolledBack' ? 0 : selected.phase === 'rollbackStarting' ? 1 : 2);
        return activationJournal;
      }),
    },
  };
  const rootStore = {
    discardBeforeActivation: vi.fn(async () => {
      record('candidate.discard');
    }),
    inspectCandidate: vi.fn(async () => {
      record('candidate.inspect');
    }),
    prepareCandidate: vi.fn(async () => {
      record('candidate.prepareRoot');
    }),
    removeImportStaging: vi.fn(async () => undefined),
  };
  const workspaceRuntimeAbsence = {
    assertNoActiveWorkspaceRuntime: vi.fn(async () => { record('runtime.absent'); }),
  };
  const coordinator = new WorkspaceActivationMigrationCoordinator({
    createBinding,
    blockContinuation,
    activationAuthorityFactory: {
      create: () => activation,
    },
    backupCandidate: {
      migrate: vi.fn(async () => {
        record('candidate.migrate');
        if (options.failCandidateMigration) {
          throw new Error('migration-failed');
        }
        return {
          handlesClosed: true,
          migrationChainIdentity: targetMigrationChainIdentity,
          profileId,
        } as const;
      }),
      validateAndMaterialize: vi.fn(async () => {
        record('candidate.validate');
        return createCandidateReadiness();
      }),
      validatePublished: vi.fn(async () => createCandidateReadiness()),
    },
    guard: {
      reprove: vi.fn(async () => {
        record('guard.reprove');
        if (!selectorCurrent) throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
      }),
    },
    maintenanceLease: {
      acquire: vi.fn(async () => {
        record('lease.acquire');
        const held = await options.maintenanceLease?.acquire('switch');
        return {
          release: vi.fn(async () => {
            record('lease.release');
            if (options.failLeaseRelease) {
              throw new Error('release-failed');
            }
            await held?.release();
            options.onRelease?.();
          }),
        };
      }),
    },
    recoveryPoint: {
      createAndStage: vi.fn(async () => {
        record('recovery.createAndStage');
        if (options.failRecoveryPoint) {
          throw new Error('recovery-point-failed');
        }
        return {
          appVersion: '0.2.6',
          artifactTotalByteSize: 1,
          createdAt: '2026-08-22T00:00:00.000Z',
          documentCount: 1,
          migrationChainIdentity: sourceMigrationChainIdentity,
          operationRoot: join(userDataRoot, 'recovery', 'staged'),
          profileId,
        };
      }),
      removeStaging: vi.fn(async () => {
        record('recovery.removeStaging');
      }),
    },
    requestRelaunch,
    rootStore,
    sourceRecovery,
    userDataRoot,
    workspaceRuntimeAbsence,
  });

  return {
    activation,
    binding,
    createBinding,
    blockContinuation,
    coordinator,
    events,
    input: {
      expectedSourceMigrationChainIdentity: sourceMigrationChainIdentity,
      proof,
      stopTargetStartupRuntime,
    },
    requestRelaunch,
    rootStore,
    sourceRecovery,
    stopTargetStartupRuntime,
    workspaceRuntimeAbsence,
  };
}

function createCandidateReadiness() {
  return Object.freeze({
    actorId: 'local-owner' as const,
    artifactRootHealth: 'ready' as const,
    companyId: 'company-test',
    databaseHealth: 'healthy' as const,
    foreignKeyHealth: 'healthy' as const,
    handlesClosed: true as const,
    lineageIdentity: Object.freeze({
      formatVersion: 1 as const,
      profileId,
    }),
    migrationChainIdentity: targetMigrationChainIdentity,
    migrationState: 'current' as const,
  });
}

function createActivationJournal(
  journalOperationId: string,
  phase: ProfileRestoreActivationJournal['phase'],
): ProfileRestoreActivationJournal {
  return {
    formatVersion: 1,
    hadActiveDatabase: true,
    hadActiveDocuments: true,
    operationId: journalOperationId,
    phase,
    revision: phase === 'prepared' ? 0 : 1,
  };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
