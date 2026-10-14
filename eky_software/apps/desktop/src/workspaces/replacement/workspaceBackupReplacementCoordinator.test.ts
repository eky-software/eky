import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceBackupReplacementError } from './workspaceBackupReplacementError.js';
import { deriveWorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from './workspaceBackupReplacementRootStore.js';
import {
  TEST_REPLACEMENT_CONTAINER_HASH,
  TEST_REPLACEMENT_CONTAINER_PATH,
  TEST_REPLACEMENT_MIGRATION_ID,
  TEST_REPLACEMENT_OTHER_WORKSPACE_ID,
  TEST_REPLACEMENT_OPERATION_ID,
  TEST_REPLACEMENT_PASSWORD,
  TEST_REPLACEMENT_PROFILE_ID,
  TEST_REPLACEMENT_WORKSPACE_ID,
  createWorkspaceBackupReplacementFixture,
} from './workspaceBackupReplacementTestSupport.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

const replacementInput = Object.freeze({
  containerPath: TEST_REPLACEMENT_CONTAINER_PATH,
  password: TEST_REPLACEMENT_PASSWORD,
  targetWorkspaceId: TEST_REPLACEMENT_WORKSPACE_ID,
});

describe('WorkspaceBackupReplacementCoordinator', () => {
  it('replaces the active workspace through the exact-lineage activation transaction', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();

    await expect(fixture.coordinator.replace(replacementInput)).resolves.toEqual({
      migrationChainIdentity: TEST_REPLACEMENT_MIGRATION_ID,
      profileId: TEST_REPLACEMENT_PROFILE_ID,
      workspaceId: TEST_REPLACEMENT_WORKSPACE_ID,
    });

    expect(fixture.events).toEqual([
      'guard.assert',
      'registry.read',
      'activationFactory.create',
      'activationJournal.read',
      'backup.inspect',
      'lease.acquire.replace',
      'guard.assert',
      'activationJournal.read',
      'registry.read',
      'lifecycle.quiesce',
      'recoveryPoint.preRestore',
      'lifecycle.stop',
      'runtime.absent',
      'root.prepare',
      'backup.stage',
      'candidate.migrate',
      'candidate.validate',
      'root.removeImportStaging',
      'root.inspectCandidate',
      'registry.read',
      'activation.prepare',
      'activation.replace',
      'lifecycle.ensure',
      'runtime.validate',
      'registry.read',
      'activation.accept',
      'lease.release',
    ]);
    expect(fixture.registry.reads).toBe(4);
    expect(fixture.activation.journal).toBeUndefined();
    expect(fixture.lifecycle.maxRunningOwners).toBe(1);
    expect(fixture.lifecycle.maxSqliteOwners).toBe(1);
    expect(fixture.lease.held).toBe(false);
  });

  it('hands the activated candidate to startup recovery before accepting it', async () => {
    const fixture = createWorkspaceBackupReplacementFixture({
      useRuntimeHandoff: true,
    });

    await expect(fixture.coordinator.replace(replacementInput)).resolves.toEqual({
      migrationChainIdentity: TEST_REPLACEMENT_MIGRATION_ID,
      profileId: TEST_REPLACEMENT_PROFILE_ID,
      workspaceId: TEST_REPLACEMENT_WORKSPACE_ID,
    });

    expect(fixture.events.slice(-3)).toEqual([
      'activation.replace',
      'runtimeHandoff.request',
      'lease.release',
    ]);
    expect(fixture.events).not.toContain('lifecycle.ensure');
    expect(fixture.events).not.toContain('runtime.validate');
    expect(fixture.events).not.toContain('activation.accept');
    expect(fixture.activation.journal?.phase).toBe('validationStarting');
    expect(fixture.runtimeHandoff.requests).toBe(1);
    expect(fixture.lease.held).toBe(false);
  });

  it('leaves a rolled-back journal for startup recovery after an activated handoff failure', async () => {
    const fixture = createWorkspaceBackupReplacementFixture({
      useRuntimeHandoff: true,
    });
    fixture.activation.fail = 'replace';

    await expect(
      fixture.coordinator.replace(replacementInput),
    ).rejects.toBeInstanceOf(WorkspaceBackupReplacementError);

    expect(fixture.events).toContain('activation.rollback');
    expect(fixture.events).toContain('runtimeHandoff.request');
    expect(fixture.events).not.toContain('activation.clearRolledBack');
    expect(fixture.events.at(-1)).toBe('lease.release');
    expect(fixture.activation.journal?.phase).toBe('rolledBack');
  });

  it('relaunches the unchanged workspace only after pre-activation cleanup', async () => {
    const fixture = createWorkspaceBackupReplacementFixture({
      useRuntimeHandoff: true,
    });
    fixture.candidate.failure = 'migration';

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_MIGRATION_FAILED',
      'candidateMigration',
    );

    expect(fixture.events.slice(-3)).toEqual([
      'root.discard',
      'runtimeHandoff.request',
      'lease.release',
    ]);
    expect(fixture.activation.journal).toBeUndefined();
  });

  it.each([false, true])(
    'preserves unresolved inspection evidence without restarting the source (handoff=%s)',
    async (useRuntimeHandoff) => {
      const root = await mkdtemp(join(tmpdir(), 'eky-replacement-preservation-'));
      cleanupRoots.push(root);
      const paths = deriveWorkspaceBackupReplacementPaths(
        root,
        TEST_REPLACEMENT_OPERATION_ID,
        TEST_REPLACEMENT_WORKSPACE_ID,
      );
      await mkdir(dirname(paths.activeDatabasePath), {
        recursive: true,
        mode: 0o700,
      });
      await mkdir(paths.activeArtifactRoot, { recursive: true, mode: 0o700 });
      await writeFile(paths.activeDatabasePath, 'unchanged active database');
      const sourcePath = join(paths.importStagingRoot, 'profile.sqlite');
      const inspectionRoot = join(
        paths.activationStagingOperationRoot,
        'inspection-unresolved',
      );
      const inspectionPath = join(inspectionRoot, 'inspection.sqlite');
      const fixture = createWorkspaceBackupReplacementFixture({
        useRuntimeHandoff,
        userDataRoot: root,
      });
      const registryBefore = fixture.registry.value;
      const store = new NodeWorkspaceBackupReplacementRootStore();
      fixture.rootStore.prepareCandidate = async () => {
        fixture.events.push('root.prepare');
        await store.prepareCandidate(paths);
        await mkdir(paths.importStagingRoot, { mode: 0o700 });
        await writeFile(sourcePath, 'original staged snapshot');
        await writeFile(paths.candidateDatabasePath, 'unpublished candidate');
        await mkdir(inspectionRoot, { mode: 0o700 });
        await writeFile(inspectionPath, 'unresolved inspection copy');
      };
      fixture.rootStore.discardBeforeActivation = async () => {
        fixture.events.push('root.discard');
        await store.discardBeforeActivation(paths);
      };
      fixture.candidate.failure = 'migration';

      await expectReplacementError(
        fixture.coordinator.replace(replacementInput),
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'cleanup',
      );

      expect(fixture.events).toContain('candidate.migrate');
      expect(fixture.events).toContain('root.discard');
      expect(fixture.events).not.toContain('root.removeImportStaging');
      expect(fixture.events).not.toContain('activation.prepare');
      expect(fixture.events).not.toContain('lifecycle.ensure');
      expect(fixture.runtimeHandoff.requests).toBe(0);
      expect(fixture.lifecycle.runningOwners).toBe(0);
      expect(fixture.registry.value).toBe(registryBefore);
      expect(fixture.activation.journal).toBeUndefined();
      await expect(readFile(sourcePath, 'utf8')).resolves.toBe(
        'original staged snapshot',
      );
      await expect(readFile(paths.candidateDatabasePath, 'utf8')).resolves.toBe(
        'unpublished candidate',
      );
      await expect(readFile(inspectionPath, 'utf8')).resolves.toBe(
        'unresolved inspection copy',
      );
      await expect(readFile(paths.activeDatabasePath, 'utf8')).resolves.toBe(
        'unchanged active database',
      );
    },
  );

  it('rejects a wrong lineage before the lease, quiesce or workspace writes', async () => {
    const fixture = createWorkspaceBackupReplacementFixture({
      profileId: 'f'.repeat(64),
    });

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
      'lineageCheck',
    );

    expect(fixture.events).toEqual([
      'guard.assert',
      'registry.read',
      'activationFactory.create',
      'activationJournal.read',
      'backup.inspect',
    ]);
    expect(fixture.preRestore.calls).toBe(0);
    expect(fixture.rootStore.prepared).toBe(false);
  });

  it('does not use matching labels as replacement authority', async () => {
    const fixture = createWorkspaceBackupReplacementFixture({
      profileId: 'f'.repeat(64),
    });

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
      'lineageCheck',
    );
    expect(fixture.registry.value.workspaces[0]?.workspaceLabel).toBe(
      fixture.registry.value.workspaces[1]?.workspaceLabel,
    );
  });

  it.each([
    ['inactive target', TEST_REPLACEMENT_OTHER_WORKSPACE_ID, 'ready', false],
    ['recovery-required target', TEST_REPLACEMENT_WORKSPACE_ID, 'recoveryRequired', false],
    ['duplicate lineage', TEST_REPLACEMENT_WORKSPACE_ID, 'ready', true],
  ] as const)(
    'rejects an %s before backup access',
    async (_label, activeWorkspaceId, lifecycleState, duplicateLineage) => {
      const fixture = createWorkspaceBackupReplacementFixture({
        activeWorkspaceId,
        duplicateLineage,
        lifecycleState,
      });

      await expectReplacementError(
        fixture.coordinator.replace(replacementInput),
        'WORKSPACE_REPLACEMENT_TARGET_INELIGIBLE',
        'targetValidation',
      );
      expect(fixture.container.inspectCalls).toBe(0);
      expect(fixture.preRestore.calls).toBe(0);
    },
  );

  it('rejects unresolved operations before reading the backup', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.guard.fail = true;

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_OPERATION_UNRESOLVED',
      'operationGuard',
    );
    expect(fixture.events).toEqual(['guard.assert']);
    expect(fixture.container.inspectCalls).toBe(0);
  });

  it('authenticates before taking the maintenance lease or stopping the runtime', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.container.failInspect = true;

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_BACKUP_FAILED',
      'backupPreflight',
    );
    expect(fixture.events).not.toContain('lease.acquire.replace');
    expect(fixture.events).not.toContain('lifecycle.quiesce');
  });

  it('quiesces accepted writes before creating preRestore and stops only after it succeeds', async () => {
    const fixture = createWorkspaceBackupReplacementFixture({
      useRuntimeHandoff: true,
    });
    fixture.preRestore.fail = true;

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_RECOVERY_POINT_FAILED',
      'preRestore',
    );
    expect(fixture.rootStore.prepared).toBe(false);
    expect(fixture.lifecycle.runningOwners).toBe(1);
    expect(fixture.runtimeReadiness.calls).toBe(0);
    expect(fixture.events).toContain('lifecycle.quiesce');
    expect(fixture.events.indexOf('lifecycle.quiesce')).toBeLessThan(
      fixture.events.indexOf('recoveryPoint.preRestore'),
    );
    expect(fixture.events).not.toContain('lifecycle.stop');
    expect(fixture.events).not.toContain('root.prepare');
    expect(fixture.events).not.toContain('activation.prepare');
    expect(fixture.events).toContain('runtimeHandoff.request');
    expect(fixture.runtimeHandoff.requests).toBe(1);
  });

  it('rejects a source changed between preflight and stage and restarts the old runtime', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.container.stageContainerHash = 'e'.repeat(64);

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_BACKUP_FAILED',
      'backupStage',
    );
    expect(fixture.rootStore.discarded).toBe(true);
    expect(fixture.lifecycle.runningOwners).toBe(1);
    expect(fixture.activation.journal).toBeUndefined();
  });

  it('classifies an invalid staging response at the staging boundary', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.container.stageAppVersion = 'not a valid version/value';

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_BACKUP_FAILED',
      'backupStage',
    );
    expect(fixture.rootStore.discarded).toBe(true);
    expect(fixture.lifecycle.runningOwners).toBe(1);
    expect(fixture.activation.journal).toBeUndefined();
  });

  it.each([
    ['migration', 'WORKSPACE_REPLACEMENT_MIGRATION_FAILED', 'candidateMigration'],
    ['validation', 'WORKSPACE_REPLACEMENT_VALIDATION_FAILED', 'candidateValidation'],
  ] as const)(
    'discards private staging after %s failure without touching the active root',
    async (failure, code, stage) => {
      const fixture = createWorkspaceBackupReplacementFixture();
      fixture.candidate.failure = failure;

      await expectReplacementError(
        fixture.coordinator.replace(replacementInput),
        code,
        stage,
      );
      expect(fixture.rootStore.discarded).toBe(true);
      expect(fixture.lifecycle.runningOwners).toBe(1);
      expect(fixture.activation.journal).toBeUndefined();
    },
  );

  it.each(['prepare', 'replace'] as const)(
    'uses the current activation rollback after %s failure',
    async (failure) => {
      const fixture = createWorkspaceBackupReplacementFixture();
      fixture.activation.fail = failure;

      await expect(
        fixture.coordinator.replace(replacementInput),
      ).rejects.toBeInstanceOf(WorkspaceBackupReplacementError);
      expect(fixture.events).toContain('activation.rollback');
      expect(fixture.events).toContain('activation.clearRolledBack');
      expect(fixture.lifecycle.runningOwners).toBe(1);
      expect(fixture.activation.journal).toBeUndefined();
    },
  );

  it('rolls back the activated candidate when post-start validation fails', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.runtimeReadiness.fail = true;

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_VALIDATION_FAILED',
      'activeRuntimeValidation',
    );
    expect(fixture.events.filter((event) => event === 'lifecycle.stop')).toHaveLength(2);
    expect(fixture.events).toContain('activation.rollback');
    expect(fixture.runtimeReadiness.calls).toBe(2);
    expect(fixture.lifecycle.runningOwners).toBe(1);
  });

  it('retains committed replacement content when accepted cleanup fails', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.activation.accept = async () => {
      fixture.events.push('activation.accept');
      await fixture.activation.commitAcceptance();
      throw new Error('synthetic terminal cleanup failed');
    };
    await expect(fixture.coordinator.replace(replacementInput))
      .rejects.toBeInstanceOf(WorkspaceBackupReplacementError);
    expect(fixture.activation.journal?.phase).toBe('accepted');
    expect(fixture.events).not.toContain('activation.rollback');
    expect(fixture.events).not.toContain('activation.clearRolledBack');
    expect(fixture.rootStore.discarded).toBe(false);
  });

  it('fails closed when registry bytes change while the lease is held', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    const initial = fixture.registry.value;
    fixture.registry.read = async function read() {
      fixture.events.push('registry.read');
      this.reads += 1;
      if (this.reads === 2) {
        return Object.freeze({ ...initial, activeWorkspaceId: null });
      }
      return initial;
    };

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
      'registryInvariant',
    );
    expect(fixture.events).not.toContain('lifecycle.quiesce');
    expect(fixture.preRestore.calls).toBe(0);
  });

  it('returns only allowlisted errors without paths, passwords or business data', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.container.failInspect = true;

    let caught: unknown;
    try {
      await fixture.coordinator.replace(replacementInput);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkspaceBackupReplacementError);
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain(TEST_REPLACEMENT_CONTAINER_PATH);
    expect(serialized).not.toContain(TEST_REPLACEMENT_PASSWORD);
    expect(serialized).not.toContain('private backup detail');
    expect(serialized).not.toContain(TEST_REPLACEMENT_CONTAINER_HASH);
  });
});

async function expectReplacementError(
  operation: Promise<unknown>,
  code: WorkspaceBackupReplacementError['code'],
  stage: WorkspaceBackupReplacementError['stage'],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code, stage });
}
