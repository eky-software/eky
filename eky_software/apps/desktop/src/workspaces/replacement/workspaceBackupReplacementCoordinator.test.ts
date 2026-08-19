import { describe, expect, it } from 'vitest';

import { WorkspaceBackupReplacementError } from './workspaceBackupReplacementError.js';
import {
  TEST_REPLACEMENT_CONTAINER_HASH,
  TEST_REPLACEMENT_CONTAINER_PATH,
  TEST_REPLACEMENT_MIGRATION_ID,
  TEST_REPLACEMENT_OTHER_WORKSPACE_ID,
  TEST_REPLACEMENT_PASSWORD,
  TEST_REPLACEMENT_PROFILE_ID,
  TEST_REPLACEMENT_WORKSPACE_ID,
  createWorkspaceBackupReplacementFixture,
} from './workspaceBackupReplacementTestSupport.js';

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
      'recoveryPoint.preRestore',
      'lifecycle.quiesce',
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

  it('creates the preRestore point before writing private staging', async () => {
    const fixture = createWorkspaceBackupReplacementFixture();
    fixture.preRestore.fail = true;

    await expectReplacementError(
      fixture.coordinator.replace(replacementInput),
      'WORKSPACE_REPLACEMENT_RECOVERY_POINT_FAILED',
      'preRestore',
    );
    expect(fixture.rootStore.prepared).toBe(false);
    expect(fixture.lifecycle.runningOwners).toBe(1);
    expect(fixture.runtimeReadiness.calls).toBe(0);
    expect(fixture.events).not.toContain('lifecycle.quiesce');
    expect(fixture.events).not.toContain('lifecycle.stop');
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
