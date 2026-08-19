import { describe, expect, it } from 'vitest';

import { createReadyWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';
import {
  TEST_IMPORT_CONTAINER_PATH,
  TEST_IMPORT_PASSWORD,
  TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
  TEST_IMPORT_PROFILE_ID,
  TEST_IMPORT_WORKSPACE_ID,
  createWorkspaceBackupImportCoordinatorFixture,
  createTestImportJournal,
  createTestImportPreflight,
  createTestImportReadiness,
  createTestImportRegistry,
} from './workspaceBackupImportTestSupport.js';

describe('WorkspaceBackupImportCoordinator', () => {
  it('imports a distinct lineage through the closed publication lifecycle', async () => {
    const fixture = createFixture();

    await expect(fixture.coordinator.import(importInput)).resolves.toEqual({
      workspaceId: TEST_IMPORT_WORKSPACE_ID,
      workspaceLabel: 'Tuotu yritys',
    });

    expect(fixture.events).toEqual([
      'lease.acquire.import',
      'journal.read',
      'quarantine.recoverStalePayloads',
      'backup.inspect',
      'registry.read',
      'lifecycle.quiesce',
      'lifecycle.stop',
      'runtimeAbsence.assert',
      'journal.write.prepared',
      'root.createCandidate',
      'journal.write.candidateRootCreated',
      'backup.stage',
      'journal.write.backupStaged',
      'candidate.migrate',
      'journal.write.candidateMigrated',
      'candidate.validate',
      'journal.write.candidateValidated',
      'root.removeImportStaging',
      'root.inspectCandidate',
      'registry.read',
      'root.publishCandidate',
      'journal.write.rootPublished',
      'root.cleanupPublishedOperation',
      'registry.write',
      'journal.write.registryPublished',
      'lifecycle.ensure',
      'journal.remove',
      'lease.release',
    ]);
    expect(fixture.journal.states).toEqual([
      'prepared',
      'candidateRootCreated',
      'backupStaged',
      'candidateMigrated',
      'candidateValidated',
      'rootPublished',
      'registryPublished',
    ]);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.root.finalExists).toBe(true);
    expect(fixture.root.candidateExists).toBe(false);
    expect(fixture.registry.value?.activeWorkspaceId).toBe(
      TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
    );
    expect(fixture.registry.value?.workspaces).toHaveLength(2);
    expect(fixture.registry.value?.workspaces[1]).toMatchObject({
      workspaceId: TEST_IMPORT_WORKSPACE_ID,
      workspaceLabel: 'Tuotu yritys',
      lifecycleState: 'ready',
      layoutVersion: 1,
      lineageIdentity: {
        formatVersion: 1,
        profileId: TEST_IMPORT_PROFILE_ID,
      },
    });
    expect(fixture.lifecycle.maxRunningRuntimeOwners).toBe(1);
    expect(fixture.lifecycle.maxOpenDatabaseHandleOwners).toBe(1);
    expect(fixture.lease.held).toBe(false);
  });

  it('keeps source paths and passwords outside every durable journal state', async () => {
    const fixture = createFixture();
    fixture.journal.failAfterState = 'candidateValidated';

    await expect(fixture.coordinator.import(importInput)).rejects.toBeInstanceOf(
      WorkspaceBackupImportError,
    );

    const serialized = JSON.stringify(fixture.journal.writes);
    expect(serialized).not.toContain(TEST_IMPORT_PASSWORD);
    expect(serialized).not.toContain(TEST_IMPORT_CONTAINER_PATH);
    expect(serialized).not.toContain('companyId');
    expect(serialized).not.toContain('actorId');
  });

  it('rejects a duplicate lineage under the maintenance lease before runtime mutation', async () => {
    const fixture = createFixture({ duplicateLineage: true });

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_LINEAGE_EXISTS',
      'lineageCheck',
    );

    expect(fixture.events).toEqual([
      'lease.acquire.import',
      'journal.read',
      'quarantine.recoverStalePayloads',
      'backup.inspect',
      'registry.read',
      'lease.release',
    ]);
    expect(fixture.lifecycle.ensureCalls).toBe(0);
    expect(fixture.journal.current).toBeUndefined();
  });

  it('does not clean plaintext or read a backup while an unresolved journal exists', async () => {
    const fixture = createFixture();
    fixture.journal.current = createTestImportJournal({ state: 'prepared' });

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      'journal',
    );

    expect(fixture.events).toEqual([
      'lease.acquire.import',
      'journal.read',
      'lease.release',
    ]);
  });

  it('cleans stale plaintext before reading a new backup', async () => {
    const fixture = createFixture();
    fixture.plaintextQuarantine.stalePayloadCount = 2;

    await expect(fixture.coordinator.import(importInput)).resolves.toMatchObject({
      workspaceId: TEST_IMPORT_WORKSPACE_ID,
    });

    expect(fixture.plaintextQuarantine.stalePayloadCount).toBe(0);
    expect(fixture.events.indexOf('quarantine.recoverStalePayloads')).toBeLessThan(
      fixture.events.indexOf('backup.inspect'),
    );
  });

  it('fails closed before backup or runtime access when plaintext recovery fails', async () => {
    const fixture = createFixture();
    fixture.plaintextQuarantine.failRecovery = true;

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      'plaintextQuarantine',
    );

    expect(fixture.events).toEqual([
      'lease.acquire.import',
      'journal.read',
      'quarantine.recoverStalePayloads',
      'lease.release',
    ]);
    expect(fixture.lifecycle.ensureCalls).toBe(0);
  });

  it('rejects a source container changed between inspection and staging', async () => {
    const fixture = createFixture();
    fixture.container.stageResult = createTestImportPreflight({
      containerSha256: 'e'.repeat(64),
    });

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_BACKUP_FAILED',
      'backupStage',
    );

    expect(fixture.candidate.migrationInputs).toHaveLength(0);
    expect(fixture.root.candidateExists).toBe(false);
    expect(fixture.root.finalExists).toBe(false);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
    expect(fixture.lease.held).toBe(false);
  });

  it.each([
    ['migrate', 'WORKSPACE_IMPORT_MIGRATION_FAILED', 'candidateMigration'],
    ['validate', 'WORKSPACE_IMPORT_VALIDATION_FAILED', 'candidateValidation'],
  ] as const)(
    'cleans a private candidate and restores the previous runtime after %s failure',
    async (failure, code, stage) => {
      const fixture = createFixture();
      fixture.candidate.failure = failure;

      await expectImportError(
        fixture.coordinator.import(importInput),
        code,
        stage,
      );

      expect(fixture.root.candidateExists).toBe(false);
      expect(fixture.root.finalExists).toBe(false);
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
      expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(1);
    },
  );

  it('rejects a candidate whose validated identity differs from the backup', async () => {
    const fixture = createFixture();
    fixture.candidate.readiness = createTestImportReadiness({
      lineageIdentity: {
        formatVersion: 1,
        profileId: 'f'.repeat(64),
      },
    });

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_VALIDATION_FAILED',
      'candidateValidation',
    );
    expect(fixture.root.finalExists).toBe(false);
    expect(fixture.registry.writes).toHaveLength(0);
  });

  it('rechecks lineage immediately before root publication', async () => {
    const fixture = createFixture();
    const initial = fixture.registry.value!;
    let reads = 0;
    fixture.registry.read = async () => {
      fixture.events.push('registry.read');
      reads += 1;
      return reads < 2 ? initial : createRegistryWithDuplicateLineage();
    };

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_LINEAGE_EXISTS',
      'lineageCheck',
    );

    expect(fixture.root.finalExists).toBe(false);
    expect(fixture.root.candidateExists).toBe(false);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current).toBeUndefined();
  });

  it('leaves a durable recovery point when root publication may have occurred', async () => {
    const fixture = createFixture();
    fixture.root.failure = 'publishAfter';

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_STORAGE_FAILED',
      'rootPublish',
    );

    expect(fixture.root.finalExists).toBe(true);
    expect(fixture.journal.current?.state).toBe('candidateValidated');
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
  });

  it('publishes the first workspace as active without starting its runtime', async () => {
    const fixture = createFixture({ emptyRegistry: true });
    fixture.lifecycle.runningRuntimeOwners = 0;
    fixture.lifecycle.openDatabaseHandleOwners = 0;

    await fixture.coordinator.import(importInput);

    expect(fixture.registry.value?.activeWorkspaceId).toBe(
      TEST_IMPORT_WORKSPACE_ID,
    );
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(0);
    expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(0);
  });

  it('restores the previous runtime when runtime absence cannot be proven', async () => {
    const fixture = createFixture();
    fixture.runtimeAbsence.state = 'unknown';

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_LIFECYCLE_FAILED',
      'runtimeAbsence',
    );

    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
    expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(1);
  });

  it('requires recovery before a second import when an import journal exists', async () => {
    const fixture = createFixture();
    fixture.journal.current = createTestImportJournal({ state: 'backupStaged' });

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      'journal',
    );

    expect(fixture.events).not.toContain('lifecycle.quiesce');
    expect(fixture.journal.current?.state).toBe('backupStaged');
  });
});

const importInput = Object.freeze({
  workspaceLabel: 'Tuotu yritys',
  containerPath: TEST_IMPORT_CONTAINER_PATH,
  password: TEST_IMPORT_PASSWORD,
});

function createFixture(options: {
  readonly duplicateLineage?: boolean;
  readonly emptyRegistry?: boolean;
} = {}) {
  return createWorkspaceBackupImportCoordinatorFixture(options);
}

function createRegistryWithDuplicateLineage(): Readonly<LocalWorkspaceRegistryV1> {
  const original = createReadyWorkspaceEntry({
    workspaceId: TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
    workspaceLabel: 'Nykyinen yritys',
    lineageIdentity: { formatVersion: 1, profileId: '9'.repeat(64) },
    createdAt: '2026-08-18T10:00:00.000Z',
  });
  const duplicate = createReadyWorkspaceEntry({
    workspaceId: '44444444-4444-4444-8444-444444444444' as WorkspaceId,
    workspaceLabel: 'Toinen yritys',
    lineageIdentity: {
      formatVersion: 1,
      profileId: TEST_IMPORT_PROFILE_ID,
    },
    createdAt: '2026-08-19T09:00:00.000Z',
  });
  return createTestImportRegistry({
    activeWorkspaceId: TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
    workspaces: [original, duplicate],
  });
}

async function expectImportError(
  operation: Promise<unknown>,
  code: WorkspaceBackupImportError['code'],
  stage: WorkspaceBackupImportError['stage'],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code, stage });
}
