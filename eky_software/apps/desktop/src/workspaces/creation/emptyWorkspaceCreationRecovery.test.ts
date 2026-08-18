import { describe, expect, it } from 'vitest';

import { EmptyWorkspaceCreationRecovery } from './emptyWorkspaceCreationRecovery.js';
import {
  createTestBootstrapResult,
  createTestJournal,
  createTestRegistry,
  MemoryWorkspaceCreationJournal,
  MemoryWorkspaceCreationRootStore,
  MemoryWorkspaceRegistry,
  RecordingActiveWorkspaceLifecycle,
  RecordingPublishedWorkspaceValidation,
  RecordingWorkspaceMaintenanceLease,
  RecordingWorkspaceRuntimeAbsence,
  TEST_USER_DATA_ROOT,
  TEST_WORKSPACE_ID,
} from './emptyWorkspaceCreationTestSupport.js';
import { createReadyWorkspaceEntry } from './workspaceCreationRegistry.js';

function createFixture(input: {
  readonly state?: Parameters<typeof createTestJournal>[0]['state'];
  readonly candidateExists?: boolean;
  readonly finalExists?: boolean;
  readonly registryPublished?: boolean;
  readonly previousActiveWorkspaceId?: Parameters<typeof createTestJournal>[0]['previousActiveWorkspaceId'];
} = {}) {
  const events: string[] = [];
  const journalValue = input.state === undefined
    ? undefined
    : createTestJournal({
        state: input.state,
        ...(input.previousActiveWorkspaceId === undefined
          ? {}
          : { previousActiveWorkspaceId: input.previousActiveWorkspaceId }),
      });
  const journal = new MemoryWorkspaceCreationJournal(events, journalValue);
  const registryEntry = journalValue === undefined || !input.registryPublished
    ? undefined
    : createReadyWorkspaceEntry({
        workspaceId: journalValue.workspaceId,
        workspaceLabel: journalValue.workspaceLabel,
        lineageIdentity: journalValue.lineageIdentity!,
        createdAt: journalValue.createdAt,
      });
  const registry = new MemoryWorkspaceRegistry(
    events,
    createTestRegistry({
      activeWorkspaceId: registryEntry === undefined
        ? (input.previousActiveWorkspaceId ?? null)
        : (input.previousActiveWorkspaceId ?? registryEntry.workspaceId),
      workspaces: registryEntry === undefined ? [] : [registryEntry],
    }),
  );
  const rootStore = new MemoryWorkspaceCreationRootStore(events);
  rootStore.candidateExists = input.candidateExists ?? false;
  rootStore.finalExists = input.finalExists ?? false;
  const lifecycle = new RecordingActiveWorkspaceLifecycle(events);
  if (input.finalExists || input.registryPublished) {
    lifecycle.runningRuntimeOwners = 0;
    lifecycle.openDatabaseHandleOwners = 0;
  }
  const validation = new RecordingPublishedWorkspaceValidation(events);
  const runtimeAbsence = new RecordingWorkspaceRuntimeAbsence(events);
  const lease = new RecordingWorkspaceMaintenanceLease(events);
  return {
    events,
    journal,
    registry,
    rootStore,
    lifecycle,
    runtimeAbsence,
    validation,
    lease,
    recovery: new EmptyWorkspaceCreationRecovery({
      activeWorkspaceLifecycle: lifecycle,
      creationJournal: journal,
      maintenanceLease: lease,
      publishedWorkspaceValidation: validation,
      registry,
      rootStore,
      userDataRoot: TEST_USER_DATA_ROOT,
      workspaceRuntimeAbsence: runtimeAbsence,
    }),
  };
}

describe('empty workspace creation recovery', () => {
  it('does nothing when no creation journal exists', async () => {
    const fixture = createFixture();

    await expect(fixture.recovery.recover()).resolves.toBe('nothingToRecover');
    expect(fixture.events).toEqual([
      'lease.acquire.create',
      'journal.read',
      'lease.release',
    ]);
  });

  it.each([
    'prepared',
    'candidateRootCreated',
    'bootstrapCompleted',
    'candidateValidated',
  ] as const)('discards a private %s operation before publication', async (state) => {
    const fixture = createFixture({ state, candidateExists: true });

    await expect(fixture.recovery.recover()).resolves.toBe(
      'discardedBeforePublication',
    );
    expect(fixture.rootStore.candidateExists).toBe(false);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.events).toContain('lifecycle.ensure');
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['candidateValidated', 'rootPublished'] as const)(
    'completes publication from a validated final root and %s journal',
    async (state) => {
      const fixture = createFixture({ state, finalExists: true });

      await expect(fixture.recovery.recover()).resolves.toBe(
        'completedPublication',
      );
      expect(fixture.validation.inputs).toHaveLength(1);
      expect(fixture.runtimeAbsence.assertionCalls).toBe(1);
      expect(fixture.events.indexOf('runtimeAbsence.assert')).toBeLessThan(
        fixture.events.indexOf('publishedValidation.run'),
      );
      expect(fixture.registry.value).toMatchObject({
        activeWorkspaceId: TEST_WORKSPACE_ID,
        workspaces: [{ workspaceId: TEST_WORKSPACE_ID }],
      });
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.events).toContain('lifecycle.ensure');
      expect(fixture.lifecycle.runningRuntimeOwners).toBe(1);
      expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(1);
      expect(fixture.lifecycle.maxRunningRuntimeOwners).toBe(1);
      expect(fixture.lifecycle.maxOpenDatabaseHandleOwners).toBe(1);
    },
  );

  it.each(['rootPublished', 'registryPublished'] as const)(
    'finishes a durable registry publication from a %s journal',
    async (state) => {
      const fixture = createFixture({
        state,
        finalExists: true,
        registryPublished: true,
      });

      await expect(fixture.recovery.recover()).resolves.toBe(
        'completedPublication',
      );
      expect(fixture.validation.inputs).toHaveLength(1);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.journal.current).toBeUndefined();
    },
  );

  it('fails closed and retains evidence when candidate and final roots coexist', async () => {
    const fixture = createFixture({
      state: 'candidateValidated',
      candidateExists: true,
      finalExists: true,
    });

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.journal.current?.state).toBe('candidateValidated');
    expect(fixture.registry.writes).toHaveLength(0);
  });

  it('fails closed when a rootPublished journal has no final root', async () => {
    const fixture = createFixture({ state: 'rootPublished' });

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.journal.current?.state).toBe('rootPublished');
  });

  it('does not publish a final root when its private validation fails', async () => {
    const fixture = createFixture({
      state: 'candidateValidated',
      finalExists: true,
    });
    fixture.validation.fail = true;

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current?.state).toBe('candidateValidated');
  });

  it.each(['active', 'unknown'] as const)(
    'fails closed before published validation when runtime state is %s',
    async (state) => {
      const fixture = createFixture({
        state: 'candidateValidated',
        finalExists: true,
      });
      fixture.runtimeAbsence.state = state;

      await expect(fixture.recovery.recover()).rejects.toMatchObject({
        code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        stage: 'recovery',
      });
      expect(fixture.runtimeAbsence.assertionCalls).toBe(1);
      expect(fixture.validation.inputs).toHaveLength(0);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.journal.current?.state).toBe('candidateValidated');
      expect(fixture.lifecycle.ensureCalls).toBe(0);
    },
  );

  it('rejects a published root whose lineage differs from the journal', async () => {
    const fixture = createFixture({
      state: 'candidateValidated',
      finalExists: true,
    });
    fixture.validation.result = createTestBootstrapResult('b', '2');

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current?.state).toBe('candidateValidated');
  });

  it('retains a registryPublished journal when ensuring the previous runtime fails', async () => {
    const fixture = createFixture({
      state: 'rootPublished',
      finalExists: true,
    });
    fixture.lifecycle.failure = 'ensure';

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      stage: 'activeRuntimeRestart',
    });
    expect(fixture.registry.value?.workspaces).toHaveLength(1);
    expect(fixture.journal.current?.state).toBe('registryPublished');
  });
});
