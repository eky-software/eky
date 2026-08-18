import { describe, expect, it } from 'vitest';

import { createImportedWorkspaceEntry } from './workspaceBackupImportRegistry.js';
import { WorkspaceBackupImportRecovery } from './workspaceBackupImportRecovery.js';
import {
  createTestImportJournal,
  createTestImportReadiness,
  createTestImportRegistry,
  MemoryWorkspaceBackupImportJournal,
  MemoryWorkspaceBackupImportRegistry,
  MemoryWorkspaceBackupImportRootStore,
  RecordingImportActiveWorkspaceLifecycle,
  RecordingImportMaintenanceLease,
  RecordingImportRuntimeAbsence,
  RecordingWorkspaceBackupCandidate,
  RecordingWorkspaceBackupPlaintextQuarantine,
  TEST_IMPORT_CREATED_AT,
  TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
  TEST_IMPORT_PROFILE_ID,
  TEST_IMPORT_USER_DATA_ROOT,
  TEST_IMPORT_WORKSPACE_ID,
} from './workspaceBackupImportTestSupport.js';
import type { WorkspaceBackupImportJournalV1 } from './workspaceBackupImportTypes.js';

describe('WorkspaceBackupImportRecovery', () => {
  it('does nothing when no import journal exists', async () => {
    const fixture = createRecoveryFixture();

    await expect(fixture.recovery.recover()).resolves.toBe(
      'nothingToRecover',
    );
    expect(fixture.events).toEqual([
      'lease.acquire.import',
      'quarantine.recoverStalePayloads',
      'journal.read',
      'lease.release',
    ]);
  });

  it('cleans stale plaintext before returning nothing to recover', async () => {
    const fixture = createRecoveryFixture();
    fixture.plaintextQuarantine.stalePayloadCount = 2;

    await expect(fixture.recovery.recover()).resolves.toBe('nothingToRecover');

    expect(fixture.plaintextQuarantine.stalePayloadCount).toBe(0);
    expect(fixture.events).toEqual([
      'lease.acquire.import',
      'quarantine.recoverStalePayloads',
      'journal.read',
      'lease.release',
    ]);
    expect(fixture.candidate.migrationInputs).toHaveLength(0);
    expect(fixture.candidate.validationInputs).toHaveLength(0);
  });

  it('fails closed before journal or root access when plaintext recovery fails', async () => {
    const fixture = createRecoveryFixture();
    fixture.plaintextQuarantine.failRecovery = true;

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      stage: 'plaintextQuarantine',
    });

    expect(fixture.events).toEqual([
      'lease.acquire.import',
      'quarantine.recoverStalePayloads',
      'lease.release',
    ]);
    expect(fixture.events).not.toContain('root.readPresence');
  });

  it.each<WorkspaceBackupImportJournalV1['state']>([
    'prepared',
    'candidateRootCreated',
    'backupStaged',
    'candidateMigrated',
    'candidateValidated',
  ])('discards a %s import before root publication', async (state) => {
    const fixture = createRecoveryFixture(createTestImportJournal({ state }));
    fixture.plaintextQuarantine.stalePayloadCount = 1;
    fixture.rootStore.candidateExists = state !== 'prepared';
    fixture.rootStore.stagingExists = [
      'candidateRootCreated',
      'backupStaged',
      'candidateMigrated',
      'candidateValidated',
    ].includes(state);

    await expect(fixture.recovery.recover()).resolves.toBe(
      'discardedBeforePublication',
    );
    expect(fixture.rootStore.candidateExists).toBe(false);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.lifecycle.ensureCalls).toBe(1);
    expect(fixture.runtimeAbsence.assertionCalls).toBe(1);
    expect(fixture.plaintextQuarantine.stalePayloadCount).toBe(0);
  });

  it('completes publication when atomic rename succeeded before the journal advanced', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'candidateValidated' }),
    );
    fixture.plaintextQuarantine.stalePayloadCount = 1;
    fixture.rootStore.finalExists = true;

    await expect(fixture.recovery.recover()).resolves.toBe(
      'completedPublication',
    );
    expect(fixture.registry.value).toMatchObject({
      activeWorkspaceId: TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
      workspaces: [
        {
          workspaceId: TEST_IMPORT_WORKSPACE_ID,
          lifecycleState: 'ready',
          lineageIdentity: { profileId: TEST_IMPORT_PROFILE_ID },
        },
      ],
    });
    expect(fixture.journal.states).toEqual([
      'rootPublished',
      'registryPublished',
    ]);
    expect(fixture.candidate.publishedInputs).toHaveLength(1);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.plaintextQuarantine.stalePayloadCount).toBe(0);
  });

  it('publishes a validated final root that has no registry entry yet', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'rootPublished' }),
    );
    fixture.rootStore.finalExists = true;

    await expect(fixture.recovery.recover()).resolves.toBe(
      'completedPublication',
    );
    expect(fixture.registry.writes).toHaveLength(1);
    expect(fixture.journal.states).toEqual(['registryPublished']);
    expect(fixture.journal.current).toBeUndefined();
  });

  it('finishes an already published registry entry without writing it again', async () => {
    const journal = createTestImportJournal({ state: 'registryPublished' });
    const fixture = createRecoveryFixture(journal, registryWithImportedEntry());
    fixture.rootStore.finalExists = true;

    await expect(fixture.recovery.recover()).resolves.toBe(
      'completedPublication',
    );
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.candidate.publishedInputs).toHaveLength(1);
  });

  it('completes a registry write that succeeded before its caller observed failure', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'rootPublished' }),
    );
    fixture.rootStore.finalExists = true;
    fixture.registry.failWriteAfter = true;

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_REGISTRY_FAILED',
      stage: 'registryPublish',
    });
    expect(fixture.registry.value?.workspaces).toHaveLength(1);
    expect(fixture.journal.current?.state).toBe('rootPublished');

    fixture.registry.failWriteAfter = false;
    await expect(fixture.recovery.recover()).resolves.toBe(
      'completedPublication',
    );
    expect(fixture.registry.writes).toHaveLength(1);
    expect(fixture.journal.current).toBeUndefined();
  });

  it('keeps a first imported workspace inactive at runtime while making it the registry active pointer', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({
        state: 'rootPublished',
        previousActiveWorkspaceId: null,
      }),
      createTestImportRegistry(),
    );
    fixture.lifecycle.runningRuntimeOwners = 0;
    fixture.lifecycle.openDatabaseHandleOwners = 0;
    fixture.rootStore.finalExists = true;

    await expect(fixture.recovery.recover()).resolves.toBe(
      'completedPublication',
    );
    expect(fixture.registry.value?.activeWorkspaceId).toBe(
      TEST_IMPORT_WORKSPACE_ID,
    );
    expect(fixture.lifecycle.runningRuntimeOwners).toBe(0);
    expect(fixture.lifecycle.openDatabaseHandleOwners).toBe(0);
  });

  it('fails closed when candidate and final roots both exist', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'candidateValidated' }),
    );
    fixture.rootStore.candidateExists = true;
    fixture.rootStore.finalExists = true;

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.journal.current?.state).toBe('candidateValidated');
    expect(fixture.lifecycle.ensureCalls).toBe(0);
  });

  it('fails closed when a published journal has no final root', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'rootPublished' }),
    );

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.journal.current?.state).toBe('rootPublished');
  });

  it('requires an absent runtime before touching candidate or published roots', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'candidateRootCreated' }),
    );
    fixture.runtimeAbsence.state = 'active';
    fixture.rootStore.candidateExists = true;

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.events).not.toContain('root.readPresence');
    expect(fixture.rootStore.candidateExists).toBe(true);
  });

  it('does not publish a final root whose stopped readiness no longer matches the journal', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'rootPublished' }),
    );
    fixture.rootStore.finalExists = true;
    fixture.candidate.readiness = createTestImportReadinessWithProfile(
      'e'.repeat(64),
    );

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current?.state).toBe('rootPublished');
  });

  it('rejects registry drift instead of changing the active workspace during recovery', async () => {
    const fixture = createRecoveryFixture(
      createTestImportJournal({ state: 'rootPublished' }),
      createTestImportRegistry({ activeWorkspaceId: null }),
    );
    fixture.rootStore.finalExists = true;

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
    });
    expect(fixture.registry.writes).toHaveLength(0);
  });
});

function createRecoveryFixture(
  journalValue?: Readonly<WorkspaceBackupImportJournalV1>,
  registryValue = createTestImportRegistry({
    activeWorkspaceId: TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
  }),
) {
  const events: string[] = [];
  const journal = new MemoryWorkspaceBackupImportJournal(events, journalValue);
  const registry = new MemoryWorkspaceBackupImportRegistry(
    events,
    registryValue,
  );
  const rootStore = new MemoryWorkspaceBackupImportRootStore(events);
  const candidate = new RecordingWorkspaceBackupCandidate(events);
  const lifecycle = new RecordingImportActiveWorkspaceLifecycle(events);
  const runtimeAbsence = new RecordingImportRuntimeAbsence(events);
  const plaintextQuarantine = new RecordingWorkspaceBackupPlaintextQuarantine(
    events,
  );
  const recovery = new WorkspaceBackupImportRecovery({
    activeWorkspaceLifecycle: lifecycle,
    backupCandidate: candidate,
    importJournal: journal,
    maintenanceLease: new RecordingImportMaintenanceLease(events),
    plaintextQuarantine,
    registry,
    rootStore,
    userDataRoot: TEST_IMPORT_USER_DATA_ROOT,
    workspaceRuntimeAbsence: runtimeAbsence,
  });
  return {
    candidate,
    events,
    journal,
    lifecycle,
    plaintextQuarantine,
    recovery,
    registry,
    rootStore,
    runtimeAbsence,
  };
}

function registryWithImportedEntry() {
  return createTestImportRegistry({
    activeWorkspaceId: TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
    workspaces: [
      createImportedWorkspaceEntry({
        workspaceId: TEST_IMPORT_WORKSPACE_ID,
        workspaceLabel: 'Tuotu yritys',
        lineageIdentity: {
          formatVersion: 1,
          profileId: TEST_IMPORT_PROFILE_ID,
        },
        createdAt: TEST_IMPORT_CREATED_AT,
      }),
    ],
  });
}

function createTestImportReadinessWithProfile(profileId: string) {
  return Object.freeze({
    ...createTestImportReadiness(),
    lineageIdentity: Object.freeze({ formatVersion: 1 as const, profileId }),
  });
}
