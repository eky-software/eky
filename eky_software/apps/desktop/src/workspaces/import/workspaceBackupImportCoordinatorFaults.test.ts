import { describe, expect, it } from 'vitest';

import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';
import {
  TEST_IMPORT_CONTAINER_PATH,
  TEST_IMPORT_PASSWORD,
  TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
  createWorkspaceBackupImportCoordinatorFixture,
} from './workspaceBackupImportTestSupport.js';
import type { WorkspaceBackupImportJournalState } from './workspaceBackupImportTypes.js';

const importInput = Object.freeze({
  workspaceLabel: 'Tuotu yritys',
  containerPath: TEST_IMPORT_CONTAINER_PATH,
  password: TEST_IMPORT_PASSWORD,
});

const journalStates = [
  'prepared',
  'candidateRootCreated',
  'backupStaged',
  'candidateMigrated',
  'candidateValidated',
  'rootPublished',
  'registryPublished',
] as const satisfies readonly WorkspaceBackupImportJournalState[];

describe('WorkspaceBackupImportCoordinator fault boundaries', () => {
  it('fails before lifecycle mutation when the import lease is already held', async () => {
    const fixture = createWorkspaceBackupImportCoordinatorFixture();
    fixture.lease.held = true;

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_BUSY',
      'lease',
    );

    expect(fixture.events).toEqual([
      'backup.inspect',
      'registry.read',
      'lease.acquire.import',
    ]);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lifecycle.ensureCalls).toBe(0);
  });

  it.each([
    ['quiesce', 0],
    ['stopBeforeSideEffect', 1],
    ['stopAfterSideEffect', 1],
  ] as const)(
    'keeps the registry unchanged and bounds runtime ownership after %s failure',
    async (failure, expectedEnsureCalls) => {
      const fixture = createWorkspaceBackupImportCoordinatorFixture();
      fixture.lifecycle.failure = failure;

      await expectImportError(
        fixture.coordinator.import(importInput),
        'WORKSPACE_IMPORT_LIFECYCLE_FAILED',
        failure === 'quiesce'
          ? 'activeRuntimeQuiesce'
          : 'activeRuntimeStop',
      );

      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.registry.value?.activeWorkspaceId).toBe(
        TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
      );
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.root.candidateExists).toBe(false);
      expect(fixture.root.finalExists).toBe(false);
      expect(fixture.lifecycle.ensureCalls).toBe(expectedEnsureCalls);
      expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
      expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(1);
      expect(fixture.lifecycle.maxRunningRuntimeOwners).toBeLessThanOrEqual(1);
      expect(
        fixture.lifecycle.maxOpenDatabaseHandleOwners,
      ).toBeLessThanOrEqual(1);
      expect(fixture.lease.held).toBe(false);
    },
  );

  it.each(['before', 'after'] as const)(
    'recovers safely when every journal transition fails %s persistence',
    async (timing) => {
      for (const state of journalStates) {
        const fixture = createWorkspaceBackupImportCoordinatorFixture();
        if (timing === 'before') fixture.journal.failBeforeState = state;
        else fixture.journal.failAfterState = state;

        await expect(
          fixture.coordinator.import(importInput),
          `${timing}:${state}`,
        ).rejects.toBeInstanceOf(WorkspaceBackupImportError);

        const publicationStarted =
          state === 'rootPublished' || state === 'registryPublished';
        expect(fixture.root.finalExists, `${timing}:${state}`).toBe(
          publicationStarted,
        );
        expect(fixture.root.candidateExists, `${timing}:${state}`).toBe(false);
        expect(
          fixture.registry.value?.activeWorkspaceId,
          `${timing}:${state}`,
        ).toBe(TEST_IMPORT_PREVIOUS_WORKSPACE_ID);
        expect(fixture.registry.writes, `${timing}:${state}`).toHaveLength(
          state === 'registryPublished' ? 1 : 0,
        );
        if (publicationStarted) {
          expect(fixture.journal.current, `${timing}:${state}`).toBeDefined();
        } else {
          expect(fixture.journal.current, `${timing}:${state}`).toBeUndefined();
        }
        expect(fixture.lifecycle.ensureCalls, `${timing}:${state}`).toBe(1);
        expect(
          fixture.lifecycle.runningRuntimeOwners,
          `${timing}:${state}`,
        ).toBe(1);
        expect(
          fixture.lifecycle.openDatabaseHandleOwners,
          `${timing}:${state}`,
        ).toBe(1);
        expect(
          fixture.lifecycle.maxRunningRuntimeOwners,
          `${timing}:${state}`,
        ).toBeLessThanOrEqual(1);
        expect(
          fixture.lifecycle.maxOpenDatabaseHandleOwners,
          `${timing}:${state}`,
        ).toBeLessThanOrEqual(1);
        expect(fixture.lease.held, `${timing}:${state}`).toBe(false);
      }
    },
  );

  it.each([
    ['createBefore', 'candidateRoot'],
    ['createAfter', 'candidateRoot'],
    ['removeStaging', 'cleanup'],
    ['inspectCandidate', 'candidateValidation'],
    ['publishBefore', 'rootPublish'],
  ] as const)(
    'removes all private state after the pre-publication %s failure',
    async (failure, stage) => {
      const fixture = createWorkspaceBackupImportCoordinatorFixture();
      fixture.root.failure = failure;

      await expectImportError(
        fixture.coordinator.import(importInput),
        'WORKSPACE_IMPORT_STORAGE_FAILED',
        stage,
      );

      expect(fixture.root.candidateExists).toBe(false);
      expect(fixture.root.finalExists).toBe(false);
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
      expect(fixture.lease.held).toBe(false);
    },
  );

  it.each([
    ['publishAfter', 'candidateValidated'],
    ['cleanupPublished', 'rootPublished'],
  ] as const)(
    'retains a durable recovery boundary after the %s publication failure',
    async (failure, expectedJournalState) => {
      const fixture = createWorkspaceBackupImportCoordinatorFixture();
      fixture.root.failure = failure;

      await expect(
        fixture.coordinator.import(importInput),
      ).rejects.toBeInstanceOf(WorkspaceBackupImportError);

      expect(fixture.root.finalExists).toBe(true);
      expect(fixture.root.candidateExists).toBe(false);
      expect(fixture.journal.current?.state).toBe(expectedJournalState);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
      expect(fixture.lease.held).toBe(false);
    },
  );

  it.each([
    ['before', false],
    ['after', true],
  ] as const)(
    'retains recoverable publication evidence when registry writing fails %s its side effect',
    async (timing, registryChanged) => {
      const fixture = createWorkspaceBackupImportCoordinatorFixture();
      fixture.registry.failWriteBefore = timing === 'before';
      fixture.registry.failWriteAfter = timing === 'after';

      await expectImportError(
        fixture.coordinator.import(importInput),
        'WORKSPACE_IMPORT_REGISTRY_FAILED',
        'registryPublish',
      );

      expect(fixture.root.finalExists).toBe(true);
      expect(fixture.journal.current?.state).toBe('rootPublished');
      expect(fixture.registry.value?.workspaces).toHaveLength(
        registryChanged ? 2 : 1,
      );
      expect(fixture.registry.value?.activeWorkspaceId).toBe(
        TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
      );
      expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
      expect(fixture.lease.held).toBe(false);
    },
  );

  it('retains registry-published evidence when restarting the previous runtime fails', async () => {
    const fixture = createWorkspaceBackupImportCoordinatorFixture();
    fixture.lifecycle.failure = 'ensure';

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      'activeRuntimeRestart',
    );

    expect(fixture.root.finalExists).toBe(true);
    expect(fixture.registry.value?.workspaces).toHaveLength(2);
    expect(fixture.journal.current?.state).toBe('registryPublished');
    expect(fixture.lifecycle.ensureCalls).toBe(1);
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(0);
    expect(fixture.lease.held).toBe(false);
  });

  it('retains registry-published evidence when terminal journal cleanup fails', async () => {
    const fixture = createWorkspaceBackupImportCoordinatorFixture();
    fixture.journal.failRemove = true;

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_JOURNAL_FAILED',
      'journal',
    );

    expect(fixture.root.finalExists).toBe(true);
    expect(fixture.registry.value?.workspaces).toHaveLength(2);
    expect(fixture.journal.current?.state).toBe('registryPublished');
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
    expect(fixture.lease.held).toBe(false);
  });

  it('fails closed when private candidate cleanup cannot be proven', async () => {
    const fixture = createWorkspaceBackupImportCoordinatorFixture();
    fixture.container.failStage = true;
    fixture.root.discardCandidate = async () => {
      fixture.events.push('root.discardCandidate');
      throw new Error('private cleanup failed');
    };

    await expectImportError(
      fixture.coordinator.import(importInput),
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      'recovery',
    );

    expect(fixture.root.candidateExists).toBe(true);
    expect(fixture.journal.current?.state).toBe('candidateRootCreated');
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
    expect(fixture.lease.held).toBe(false);
  });

  it('does not expose source input or raw infrastructure errors', async () => {
    const fixture = createWorkspaceBackupImportCoordinatorFixture();
    fixture.container.stage = async () => {
      throw new Error(
        `${TEST_IMPORT_CONTAINER_PATH}:${TEST_IMPORT_PASSWORD}\nraw stack`,
      );
    };

    const failure = await fixture.coordinator.import(importInput).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(WorkspaceBackupImportError);
    expect(failure).toMatchObject({
      code: 'WORKSPACE_IMPORT_BACKUP_FAILED',
      stage: 'backupStage',
    });
    expect(JSON.stringify(failure)).not.toContain(TEST_IMPORT_CONTAINER_PATH);
    expect(JSON.stringify(failure)).not.toContain(TEST_IMPORT_PASSWORD);
    expect(String(failure)).not.toContain('raw stack');
  });
});

async function expectImportError(
  operation: Promise<unknown>,
  code: WorkspaceBackupImportError['code'],
  stage: WorkspaceBackupImportError['stage'],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code, stage });
}
