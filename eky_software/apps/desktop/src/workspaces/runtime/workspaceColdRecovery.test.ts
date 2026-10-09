import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSafeStartupFailureCode, runSafeDesktopStartup } from '../../main/earlyStartup.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import { EmptyWorkspaceCreationRecovery } from '../creation/emptyWorkspaceCreationRecovery.js';
import {
  createTestJournal,
  createTestRegistry,
  MemoryWorkspaceCreationJournal,
  MemoryWorkspaceCreationRootStore,
  MemoryWorkspaceRegistry,
  RecordingPublishedWorkspaceValidation,
  RecordingWorkspaceMaintenanceLease,
  RecordingWorkspaceRuntimeAbsence,
  TEST_SECOND_WORKSPACE_ID,
} from '../creation/emptyWorkspaceCreationTestSupport.js';
import type { WorkspaceCreationJournal } from '../creation/workspaceCreationTypes.js';
import { WorkspaceBackupImportRecovery } from '../import/workspaceBackupImportRecovery.js';
import {
  createTestImportJournal,
  MemoryWorkspaceBackupImportJournal,
  MemoryWorkspaceBackupImportRootStore,
  RecordingWorkspaceBackupCandidate,
  RecordingWorkspaceBackupPlaintextQuarantine,
} from '../import/workspaceBackupImportTestSupport.js';
import type { WorkspaceBackupImportJournal } from '../import/workspaceBackupImportTypes.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { createReadyWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';

type RecoveryKind = 'creation' | 'import';
type JournalState = WorkspaceCreationJournal['state'] | WorkspaceBackupImportJournal['state'];
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function createFixture(kind: RecoveryKind, input: {
  readonly state?: JournalState;
  readonly published?: boolean;
  readonly registryPublished?: boolean;
  readonly firstWorkspace?: boolean;
  readonly afterPublishedValidation?: () => void;
  readonly formatVersion?: 1 | 2;
} = {}) {
  const userDataRoot = await mkdtemp(join(tmpdir(), 'eky-cold-recovery-'));
  roots.push(userDataRoot);
  const events: string[] = [];
  const previousId = input.firstWorkspace ? null : TEST_SECOND_WORKSPACE_ID;
  const common = { previousActiveWorkspaceId: previousId };
  if (kind === 'creation' && (input.state === 'backupStaged' || input.state === 'candidateMigrated')) {
    throw new Error('invalid creation fixture state');
  }
  if (kind === 'import' && input.state === 'bootstrapCompleted') {
    throw new Error('invalid import fixture state');
  }
  const value = { ...(kind === 'creation'
    ? createTestJournal({ ...common, state: (input.state ?? 'prepared') as WorkspaceCreationJournal['state'] })
    : createTestImportJournal({ ...common, state: (input.state ?? 'prepared') as WorkspaceBackupImportJournal['state'] })),
  formatVersion: input.formatVersion ?? 2 };
  const targetEntry = createReadyWorkspaceEntry({
    workspaceId: value.workspaceId,
    workspaceLabel: value.workspaceLabel,
    lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) },
    createdAt: value.createdAt,
  });
  const previousEntry = createReadyWorkspaceEntry({
    workspaceId: TEST_SECOND_WORKSPACE_ID,
    workspaceLabel: 'Previous synthetic workspace',
    lineageIdentity: { formatVersion: 1, profileId: 'b'.repeat(64) },
    createdAt: value.createdAt,
  });
  const registry = new MemoryWorkspaceRegistry(events, validateWorkspaceRegistry(createTestRegistry({
    activeWorkspaceId: previousId ?? (input.registryPublished ? value.workspaceId : null),
    workspaces: [
      ...(previousId === null ? [] : [previousEntry]),
      ...(input.registryPublished ? [targetEntry] : []),
    ],
  })));
  const previousRoot = deriveWorkspaceRoot(userDataRoot, previousEntry.workspaceId, 1).workspaceRoot;
  const targetRoot = deriveWorkspaceRoot(userDataRoot, targetEntry.workspaceId, 1).workspaceRoot;
  await mkdir(join(userDataRoot, 'workspaces'), { mode: 0o700 });
  if (previousId !== null) await mkdir(previousRoot, { mode: 0o700 });
  if (input.published) await mkdir(targetRoot, { mode: 0o700 });
  const lease = new RecordingWorkspaceMaintenanceLease(events);
  const absence = new RecordingWorkspaceRuntimeAbsence(events);
  const quarantine = new RecordingWorkspaceBackupPlaintextQuarantine(events);
  quarantine.stalePayloadCount = 1;
  const assertRecoveryAdmission = vi.fn(async () => {
    events.push('recoveryAdmission.assert');
    expect(lease.held).toBe(true);
  });
  const base = {
    completionMode: 'beforeRuntimeStart' as const,
    assertRecoveryAdmission,
    maintenanceLease: lease,
    registry,
    userDataRoot,
    workspaceRuntimeAbsence: absence,
  };
  const commonFixture = { events, registry, lease, absence, quarantine, previousRoot, targetRoot, previousId, targetEntry, assertRecoveryAdmission };
  if (kind === 'creation') {
    const journal = new MemoryWorkspaceCreationJournal(events, input.state === undefined ? undefined : value as WorkspaceCreationJournal);
    const rootStore = new MemoryWorkspaceCreationRootStore(events);
    rootStore.finalExists = input.published ?? false;
    rootStore.candidateExists = !input.published && input.state !== undefined;
    const validation = new RecordingPublishedWorkspaceValidation(events);
    const validatePublished = validation.validatePublished.bind(validation);
    vi.spyOn(validation, 'validatePublished').mockImplementation(async (value) => {
      const result = await validatePublished(value);
      input.afterPublishedValidation?.();
      return result;
    });
    return { ...commonFixture, journal, rootStore,
      recovery: new EmptyWorkspaceCreationRecovery({ ...base, creationJournal: journal,
        publishedWorkspaceValidation: validation, rootStore }),
      failValidation: () => { validation.fail = true; },
    };
  }
  const journal = new MemoryWorkspaceBackupImportJournal(events, input.state === undefined ? undefined : value as WorkspaceBackupImportJournal);
  const rootStore = new MemoryWorkspaceBackupImportRootStore(events);
  rootStore.finalExists = input.published ?? false;
  rootStore.candidateExists = !input.published && input.state !== undefined;
  const candidate = new RecordingWorkspaceBackupCandidate(events);
  const validatePublished = candidate.validatePublished.bind(candidate);
  vi.spyOn(candidate, 'validatePublished').mockImplementation(async (value) => {
    const result = await validatePublished(value);
    input.afterPublishedValidation?.();
    return result;
  });
  return { ...commonFixture, journal, rootStore,
    recovery: new WorkspaceBackupImportRecovery({ ...base, backupCandidate: candidate,
      importJournal: journal, plaintextQuarantine: quarantine, rootStore }),
    failValidation: () => { candidate.failure = 'validatePublished'; },
  };
}

describe.each(['creation', 'import'] as const)('%s cold recovery', (kind) => {
  const errorCode = kind === 'creation' ? 'WORKSPACE_CREATION_RECOVERY_REQUIRED' : 'WORKSPACE_IMPORT_RECOVERY_REQUIRED';

  it('rejects a legacy journal even if the admission port mistakenly grants it', async () => {
    const fixture = await createFixture(kind, { state: 'prepared', formatVersion: 1 });
    const before = fixture.journal.current;
    await expect(fixture.recovery.recover()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(fixture.journal.current).toEqual(before);
    expect(fixture.rootStore.candidateExists).toBe(true);
    expect(fixture.quarantine.stalePayloadCount).toBe(1);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.events).not.toContain('lifecycle.ensure');
    expect(fixture.lease.held).toBe(false);
  });

  it('checks admission under the lease after absence and before any repairing read or cleanup', async () => {
    const fixture = await createFixture(kind, { state: 'prepared' });
    await expect(fixture.recovery.recover()).resolves.toBe('discardedBeforePublication');
    expect(fixture.events.slice(0, 3)).toEqual([
      `lease.acquire.${kind === 'creation' ? 'create' : 'import'}`,
      'runtimeAbsence.assert', 'recoveryAdmission.assert',
    ]);
    expect(fixture.assertRecoveryAdmission).toHaveBeenCalledOnce();
    expect(fixture.lease.held).toBe(false);
  });

  it('preserves an admission rejection through early startup without mutating recovery state', async () => {
    const fixture = await createFixture(kind, { state: 'prepared' });
    fixture.assertRecoveryAdmission.mockImplementation(async () => {
      fixture.events.push('recoveryAdmission.assert');
      expect(fixture.lease.held).toBe(true);
      throw new WorkspaceManagementRecoveryRequiredError();
    });
    const onFailure = vi.fn();
    const exitApplication = vi.fn();
    await runSafeDesktopStartup({
      waitUntilReady: async () => undefined,
      loadRuntime: async () => ({ startDesktopComposition: () => fixture.recovery.recover() }),
      startRuntime: async (start) => { await start(); },
      onFailure,
      exitApplication,
    });
    expect(onFailure).toHaveBeenCalledWith('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(exitApplication).toHaveBeenCalledWith(1);
    expect(fixture.events).toEqual([
      `lease.acquire.${kind === 'creation' ? 'create' : 'import'}`,
      'runtimeAbsence.assert', 'recoveryAdmission.assert', 'lease.release',
    ]);
    expect(fixture.journal.current?.state).toBe('prepared');
    expect(fixture.rootStore.candidateExists).toBe(true);
    expect(fixture.quarantine.stalePayloadCount).toBe(1);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lease.held).toBe(false);
  });

  it('does not expose an unexpected admission exception', async () => {
    const fixture = await createFixture(kind, { state: 'prepared' });
    fixture.assertRecoveryAdmission.mockRejectedValue(new Error('synthetic private admission error'));
    const result = await fixture.recovery.recover().catch((error: unknown) => error);
    expect(readSafeStartupFailureCode(result)).toBe(errorCode);
    expect(fixture.journal.current?.state).toBe('prepared');
    expect(fixture.quarantine.stalePayloadCount).toBe(1);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lease.held).toBe(false);
  });

  it.each([
    { state: 'candidateValidated', registryPublished: false },
    { state: 'rootPublished', registryPublished: false },
    { state: 'rootPublished', registryPublished: true },
    { state: 'registryPublished', registryPublished: true },
  ] as const)('reconciles publication $state/$registryPublished without starting a runtime', async (input) => {
    const fixture = await createFixture(kind, { ...input, published: true });
    await expect(fixture.recovery.recover()).resolves.toBe('completedPublication');
    expect(fixture.registry.value?.activeWorkspaceId).toBe(fixture.previousId);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.events).not.toContain('lifecycle.ensure');
    expect(fixture.events.lastIndexOf('registry.read')).toBeLessThan(fixture.events.indexOf('journal.remove'));
    const registry = fixture.registry.value;
    await expect(fixture.recovery.recover()).resolves.toBe('nothingToRecover');
    expect(fixture.registry.value).toEqual(registry);
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['candidateValidated', 'rootPublished', 'registryPublished'] as const)(
    'continues exactly the first published workspace from %s', async (state) => {
      const fixture = await createFixture(kind, { state, published: true,
        registryPublished: state === 'registryPublished', firstWorkspace: true });
      await expect(fixture.recovery.recover()).resolves.toBe('completedPublication');
      expect(fixture.registry.value?.activeWorkspaceId).toBe(fixture.targetEntry.workspaceId);
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.events).not.toContain('lifecycle.ensure');
    },
  );

  const unpublishedStates: JournalState[] = kind === 'creation'
    ? ['prepared', 'candidateRootCreated', 'bootstrapCompleted', 'candidateValidated']
    : ['prepared', 'candidateRootCreated', 'backupStaged', 'candidateMigrated', 'candidateValidated'];
  it.each(unpublishedStates)('discards %s only with the exact previous continuation', async (state) => {
    const fixture = await createFixture(kind, { state });
    const registry = fixture.registry.value;
    await expect(fixture.recovery.recover()).resolves.toBe('discardedBeforePublication');
    expect(fixture.registry.value).toEqual(registry);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.events).not.toContain('lifecycle.ensure');
  });

  it.each(unpublishedStates)('retains an unpublished first %s operation with no continuation', async (state) => {
    const fixture = await createFixture(kind, { state, firstWorkspace: true });
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode, stage: 'recovery' });
    expect(fixture.journal.current?.state).toBe(state);
    expect(fixture.rootStore.candidateExists).toBe(true);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['active', 'unknown'] as const)('rejects %s runtime before journal repair or cleanup', async (state) => {
    const fixture = await createFixture(kind, { state: 'prepared' });
    fixture.absence.state = state;
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.events).toEqual([`lease.acquire.${kind === 'creation' ? 'create' : 'import'}`, 'runtimeAbsence.assert', 'lease.release']);
    expect(fixture.rootStore.candidateExists).toBe(true);
    expect(fixture.quarantine.stalePayloadCount).toBe(1);
    expect(fixture.journal.current?.state).toBe('prepared');
  });

  it('retains a published journal when its target fails full validation', async () => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true });
    fixture.failValidation();
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.journal.current?.state).toBe('rootPublished');
    expect(fixture.registry.writes).toHaveLength(0);
  });

  it('retains the journal if runtime absence becomes unknown before terminal completion', async () => {
    const fixture = await createFixture(kind, { state: 'registryPublished', published: true, registryPublished: true });
    vi.spyOn(fixture.rootStore, 'cleanupPublishedOperation').mockImplementation(async () => {
      fixture.absence.state = 'unknown';
    });
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.journal.current?.state).toBe('registryPublished');
    expect(fixture.events).not.toContain('journal.remove');
  });

  it('does not clean or publish after validation loses exclusive ownership', async () => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true,
      afterPublishedValidation: () => { fixture.absence.state = 'unknown'; },
    });
    const cleanup = vi.spyOn(fixture.rootStore, 'cleanupPublishedOperation');
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(cleanup).not.toHaveBeenCalled();
    expect(fixture.journal.current?.state).toBe('rootPublished');
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lease.held).toBe(false);
  });

  it('does not overwrite a registry changed during published target validation', async () => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true,
      afterPublishedValidation: () => {
        fixture.registry.value = { ...fixture.registry.value!, activeWorkspaceId: null };
      },
    });
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.registry.value?.activeWorkspaceId).toBeNull();
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current?.state).toBe('rootPublished');
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['absentToEmpty', 'emptyToAbsent'] as const)(
    'preserves the registry when first publication observes %s', async (change) => {
      const fixture = await createFixture(kind, { state: 'rootPublished', published: true,
        firstWorkspace: true,
        afterPublishedValidation: () => {
          fixture.registry.value = change === 'absentToEmpty' ? createTestRegistry() : undefined;
        },
      });
      if (change === 'absentToEmpty') fixture.registry.value = undefined;
      await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
      expect(fixture.registry.value).toEqual(change === 'absentToEmpty' ? createTestRegistry() : undefined);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.journal.current?.state).toBe('rootPublished');
    },
  );

  it('publishes the first workspace when the original registry remains absent', async () => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true, firstWorkspace: true });
    fixture.registry.value = undefined;
    await expect(fixture.recovery.recover()).resolves.toBe('completedPublication');
    expect((await fixture.registry.read())?.activeWorkspaceId).toBe(fixture.targetEntry.workspaceId);
    expect(fixture.journal.current).toBeUndefined();
  });

  it.each(['registry', 'root'] as const)('retains evidence when candidate cleanup changes the continuation %s', async (change) => {
    const fixture = await createFixture(kind, { state: 'prepared' });
    const discardCandidate = fixture.rootStore.discardCandidate.bind(fixture.rootStore);
    vi.spyOn(fixture.rootStore, 'discardCandidate').mockImplementation(async (paths) => {
      await discardCandidate(paths);
      if (change === 'registry') fixture.registry.value = undefined;
      else await rm(fixture.previousRoot, { recursive: true });
    });
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.journal.current?.state).toBe('prepared');
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lease.held).toBe(false);
  });

  it('rejects a registry change after the first terminal read', async () => {
    const fixture = await createFixture(kind, { state: 'registryPublished', published: true, registryPublished: true });
    const expected = fixture.registry.value!;
    const changed = { ...expected, activeWorkspaceId: fixture.targetEntry.workspaceId };
    vi.spyOn(fixture.registry, 'read').mockResolvedValue(changed)
      .mockResolvedValueOnce(expected).mockResolvedValueOnce(expected);
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.journal.current?.state).toBe('registryPublished');
  });

  it('does not substitute another ready workspace for an unpublished first operation', async () => {
    const fixture = await createFixture(kind, { state: 'prepared', firstWorkspace: true });
    fixture.registry.value = createTestRegistry({
      activeWorkspaceId: fixture.targetEntry.workspaceId,
      workspaces: [fixture.targetEntry],
    });
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.journal.current?.state).toBe('prepared');
    expect(fixture.rootStore.candidateExists).toBe(true);
  });

  it.each(['prepared', 'registryPublished'] as const)('keeps %s when the continuation root is missing', async (state) => {
    const fixture = await createFixture(kind, { state,
      published: state === 'registryPublished', registryPublished: state === 'registryPublished' });
    await rm(fixture.previousRoot, { recursive: true });
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.journal.current?.state).toBe(state);
  });

  it.each(['pointer', 'lineage', 'entryMissing', 'notReady', 'registryMissing'] as const)(
    'retains evidence when a fresh registry has changed: %s', async (change) => {
      const fixture = await createFixture(kind, { state: 'registryPublished', published: true, registryPublished: true });
      const expected = fixture.registry.value!;
      const changed = change === 'registryMissing' ? undefined : {
        ...expected,
        activeWorkspaceId: change === 'pointer' ? fixture.targetEntry.workspaceId : expected.activeWorkspaceId,
        workspaces: change === 'entryMissing' ? [fixture.targetEntry] : expected.workspaces.map((entry) =>
          entry.workspaceId !== fixture.previousId ? entry : {
            ...entry,
            ...(change === 'notReady' ? { lifecycleState: 'recoveryRequired' as const } : {}),
            ...(change === 'lineage' ? { lineageIdentity: { formatVersion: 1 as const, profileId: 'c'.repeat(64) } } : {}),
          }),
      };
      vi.spyOn(fixture.registry, 'read').mockResolvedValue(changed).mockResolvedValueOnce(expected);
      await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
      expect(fixture.journal.current?.state).toBe('registryPublished');
      expect(fixture.events).not.toContain('journal.remove');
    },
  );

  it('keeps a failed terminal removal restartable without another publication', async () => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true });
    fixture.journal.failRemove = true;
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.journal.current?.state).toBe('registryPublished');
    fixture.journal.failRemove = false;
    await expect(fixture.recovery.recover()).resolves.toBe('completedPublication');
    expect(fixture.registry.writes).toHaveLength(1);
    expect(fixture.journal.current).toBeUndefined();
  });

  it('does not treat a journal-free startup as permission to skip normal validation', async () => {
    const fixture = await createFixture(kind);
    await expect(fixture.recovery.recover()).resolves.toBe('nothingToRecover');
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.events).not.toContain('lifecycle.ensure');
    if (kind === 'import') expect(fixture.quarantine.stalePayloadCount).toBe(1);
  });

  it('does not clean journal-free plaintext without cold runtime absence', async () => {
    const fixture = await createFixture(kind);
    fixture.absence.state = 'unknown';
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.quarantine.stalePayloadCount).toBe(1);
    expect(fixture.events).not.toContain('journal.read');
  });
});
