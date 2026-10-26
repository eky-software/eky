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
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { createReadyWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { validateWorkspaceRegistry, WORKSPACE_REGISTRY_MAX_ENTRIES } from '../registry/workspaceRegistryValidation.js';

type RecoveryKind = 'creation' | 'import';
type JournalState = WorkspaceCreationJournal['state'] | WorkspaceBackupImportJournal['state'];
const roots: string[] = [];

afterEach(async (context) => {
  vi.restoreAllMocks();
  const completedRoots = roots.splice(0);
  if (context.task.result?.state !== 'pass') return;
  for (const root of completedRoots) await rm(root, { recursive: true, force: true });
});

async function createFixture(kind: RecoveryKind, input: {
  readonly state?: JournalState;
  readonly published?: boolean;
  readonly registryPublished?: boolean;
  readonly firstWorkspace?: boolean;
  readonly afterPublishedValidation?: () => void;
  readonly formatVersion?: 1 | 2;
  readonly registryFormatVersion?: 1 | 2;
  readonly selector?: boolean;
  readonly duplicateLabel?: boolean;
} = {}) {
  const userDataRoot = await mkdtemp(join(tmpdir(), 'eky-cold-recovery-'));
  roots.push(userDataRoot);
  const events: string[] = [];
  const previousId = input.firstWorkspace || input.selector ? null : TEST_SECOND_WORKSPACE_ID;
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
    workspaceLabel: input.duplicateLabel
      ? value.workspaceLabel.toUpperCase().replace(' ', '\u00a0\u00a0')
      : 'Previous synthetic workspace',
    lineageIdentity: { formatVersion: 1, profileId: 'b'.repeat(64) },
    createdAt: value.createdAt,
  });
  const registryFormatVersion = input.registryFormatVersion ?? 1;
  const registry = new MemoryWorkspaceRegistry(events, validateWorkspaceRegistry({
    ...createTestRegistry(),
    formatVersion: registryFormatVersion,
    activeWorkspaceId: previousId ?? (registryFormatVersion === 1 && input.registryPublished ? value.workspaceId : null),
    workspaces: [
      ...(previousId === null && !input.selector ? [] : [previousEntry]),
      ...(input.registryPublished ? [targetEntry] : []),
    ],
  }));
  const previousRoot = deriveWorkspaceRoot(userDataRoot, previousEntry.workspaceId, 1).workspaceRoot;
  const targetRoot = deriveWorkspaceRoot(userDataRoot, targetEntry.workspaceId, 1).workspaceRoot;
  await mkdir(join(userDataRoot, 'workspaces'), { mode: 0o700 });
  if (previousId !== null || input.selector) await mkdir(previousRoot, { mode: 0o700 });
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

  it.each([
    { state: 'prepared', empty: true },
    { state: 'prepared', empty: false },
    { state: 'rootPublished', empty: true },
    { state: 'rootPublished', empty: false },
  ] as const)('preserves recovery evidence if the v2 registry is missing ($state/$empty)', async ({ state, empty }) => {
    const fixture = await createFixture(kind, {
      state, published: state === 'rootPublished', registryFormatVersion: 2,
      firstWorkspace: empty, selector: !empty,
    });
    const before = fixture.journal.current;
    fixture.registry.value = undefined;
    await expect(fixture.recovery.recover()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(fixture.registry.value).toBeUndefined();
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current).toEqual(before);
    expect(fixture.rootStore.finalExists).toBe(state === 'rootPublished');
    expect(fixture.rootStore.candidateExists).toBe(state === 'prepared');
    expect(fixture.quarantine.stalePayloadCount).toBe(1);
    expect(fixture.events).not.toContain('journal.remove');
    expect(fixture.events).not.toContain('lifecycle.ensure');
    expect(fixture.lease.held).toBe(false);
  });

  it.each([
    { state: 'candidateValidated', registryPublished: false },
    { state: 'rootPublished', registryPublished: false },
    { state: 'rootPublished', registryPublished: true },
    { state: 'registryPublished', registryPublished: true },
  ] as const)('preserves the v2 selector after publication $state/$registryPublished', async (input) => {
    const fixture = await createFixture(kind, {
      ...input, registryFormatVersion: 2, selector: true, published: true, duplicateLabel: true,
    });
    const previous = fixture.registry.value!;
    await expect(fixture.recovery.recover()).resolves.toBe('completedPublication');
    expect(fixture.registry.value).toEqual({
      ...previous,
      workspaces: input.registryPublished ? previous.workspaces : [...previous.workspaces, fixture.targetEntry],
    });
    expect(fixture.registry.value?.activeWorkspaceId).toBeNull();
    expect(fixture.registry.value?.formatVersion).toBe(2);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.events).not.toContain('lifecycle.ensure');
    expect(fixture.events.lastIndexOf('runtimeAbsence.assert')).toBeLessThan(fixture.events.indexOf('journal.remove'));
    await expect(fixture.recovery.recover()).resolves.toBe('nothingToRecover');
    expect(fixture.lease.held).toBe(false);
  });

  it.each([false, true])('returns to the v2 selector after unpublished work (empty: %s)', async (empty) => {
    const fixture = await createFixture(kind, {
      state: 'prepared', registryFormatVersion: 2, firstWorkspace: empty, selector: !empty,
    });
    const before = fixture.registry.value;
    await expect(fixture.recovery.recover()).resolves.toBe('discardedBeforePublication');
    expect(fixture.registry.value).toBe(before);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.rootStore.candidateExists).toBe(false);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.events).not.toContain('lifecycle.ensure');
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['validation', 'runtime', 'registry', 'selection'] as const)(
    'retains a v2 selector publication on uncertain %s', async (fault) => {
      const fixture = await createFixture(kind, {
        state: 'rootPublished', published: true, registryFormatVersion: 2, selector: true,
        afterPublishedValidation: () => {
          if (fault === 'runtime') fixture.absence.state = 'unknown';
          if (fault === 'registry') fixture.registry.value = undefined;
          if (fault === 'selection') fixture.registry.value = {
            ...fixture.registry.value!, activeWorkspaceId: TEST_SECOND_WORKSPACE_ID,
          };
        },
      });
      if (fault === 'validation') fixture.failValidation();
      await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
      expect(fixture.journal.current?.state).toBe('rootPublished');
      expect(fixture.rootStore.finalExists).toBe(true);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.events).not.toContain('lifecycle.ensure');
      expect(fixture.events).not.toContain('journal.remove');
      expect(fixture.lease.held).toBe(false);
    },
  );

  it.each([false, true])('rejects a legacy journal even if admission grants it (duplicate label: %s)', async (duplicateLabel) => {
    const fixture = await createFixture(kind, { state: 'prepared', formatVersion: 1, duplicateLabel });
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

  it.each(['candidateValidated', 'rootPublished'] as const)(
    'finishes a previously published %s root despite a historical label conflict', async (state) => {
      const fixture = await createFixture(kind, { state, published: true, duplicateLabel: true });
      const previousRegistry = fixture.registry.value!;
      const previousJournal = fixture.journal.current!;

      await expect(fixture.recovery.recover()).resolves.toBe('completedPublication');

      expect(fixture.registry.value).toEqual({
        ...previousRegistry,
        workspaces: [...previousRegistry.workspaces, fixture.targetEntry],
      });
      expect(fixture.targetEntry.workspaceLabel).toBe(previousJournal.workspaceLabel);
      expect(fixture.registry.writes).toHaveLength(1);
      expect(fixture.rootStore.finalExists).toBe(true);
      expect(fixture.rootStore.candidateExists).toBe(false);
      expect(fixture.events).not.toContain('root.discardCandidate');
      const validationEvent = kind === 'creation' ? 'publishedValidation.run' : 'candidate.validatePublished';
      expect(fixture.events.indexOf('root.inspectPublished')).toBeLessThan(fixture.events.indexOf(validationEvent));
      expect(fixture.events.indexOf(validationEvent)).toBeLessThan(fixture.events.indexOf('registry.write'));
      expect(fixture.events.lastIndexOf('runtimeAbsence.assert')).toBeLessThan(fixture.events.indexOf('journal.remove'));
      expect(fixture.events).not.toContain('lifecycle.ensure');
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.lease.held).toBe(false);
      await expect(fixture.recovery.recover()).resolves.toBe('nothingToRecover');
      expect(fixture.registry.writes).toHaveLength(1);
    },
  );

  it.each(['prepared', 'candidateValidated'] as const)(
    'does not turn an unpublished %s name collision into a completed publication', async (state) => {
      const fixture = await createFixture(kind, { state, duplicateLabel: true });
      const registry = fixture.registry.value;
      await expect(fixture.recovery.recover()).resolves.toBe('discardedBeforePublication');
      expect(fixture.registry.value).toBe(registry);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.rootStore.finalExists).toBe(false);
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.lease.held).toBe(false);
    },
  );

  it('preserves the capacity-specific failure when recovering a historical label conflict', async () => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true, duplicateLabel: true });
    fixture.registry.value = validateWorkspaceRegistry({ ...fixture.registry.value!, workspaces: [
      ...fixture.registry.value!.workspaces,
      ...Array.from({ length: WORKSPACE_REGISTRY_MAX_ENTRIES - 1 }, (_, index) => createReadyWorkspaceEntry({
        workspaceId: validateWorkspaceId(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
        workspaceLabel: `Other synthetic workspace ${index + 1}`,
        lineageIdentity: { formatVersion: 1, profileId: (index + 1).toString(16).padStart(64, '0') },
        createdAt: fixture.targetEntry.createdAt,
      })),
    ] });
    const registry = fixture.registry.value;
    const journal = fixture.journal.current;

    await expect(fixture.recovery.recover()).rejects.toMatchObject({
      code: kind === 'creation' ? 'WORKSPACE_CREATION_CAPACITY_EXCEEDED' : 'WORKSPACE_IMPORT_CAPACITY_EXCEEDED',
      stage: 'identityGeneration',
    });
    expect(fixture.registry.value).toBe(registry);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current).toBe(journal);
    expect(fixture.rootStore.finalExists).toBe(true);
    expect(fixture.events).not.toContain('journal.remove');
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['unexpectedState', 'candidatePresent', 'existingIdentity'] as const)(
    'does not use a historical label conflict to bypass %s', async (fault) => {
      const fixture = await createFixture(kind, { state: fault === 'unexpectedState' ? 'prepared' : 'rootPublished',
        published: true, duplicateLabel: true });
      if (fault === 'candidatePresent') fixture.rootStore.candidateExists = true;
      if (fault === 'existingIdentity') {
        fixture.registry.value = { ...fixture.registry.value!, workspaces: [
          ...fixture.registry.value!.workspaces,
          { ...fixture.targetEntry, lineageIdentity: { formatVersion: 1, profileId: 'c'.repeat(64) } },
        ] };
      }
      const registry = fixture.registry.value;
      const journal = fixture.journal.current;
      await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode, stage: 'recovery' });
      expect(fixture.registry.value).toBe(registry);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.journal.current).toBe(journal);
      expect(fixture.rootStore.finalExists).toBe(true);
      expect(fixture.events).not.toContain('root.cleanupPublishedOperation');
      expect(fixture.lease.held).toBe(false);
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

  it.each([false, true])('retains a published journal when full validation fails (duplicate label: %s)', async (duplicateLabel) => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true, duplicateLabel });
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

  it.each([false, true])('does not clean or publish after losing ownership (duplicate label: %s)', async (duplicateLabel) => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true, duplicateLabel,
      afterPublishedValidation: () => { fixture.absence.state = 'unknown'; },
    });
    const cleanup = vi.spyOn(fixture.rootStore, 'cleanupPublishedOperation');
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(cleanup).not.toHaveBeenCalled();
    expect(fixture.journal.current?.state).toBe('rootPublished');
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lease.held).toBe(false);
  });

  it.each([false, true])('does not overwrite registry drift during validation (duplicate label: %s)', async (duplicateLabel) => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true, duplicateLabel,
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

  it('rejects registry disappearance during first publication validation', async () => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true,
      firstWorkspace: true,
      afterPublishedValidation: () => {
        fixture.registry.value = undefined;
      },
    });
    await expect(fixture.recovery.recover()).rejects.toMatchObject({ code: errorCode });
    expect(fixture.registry.value).toBeUndefined();
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current?.state).toBe('rootPublished');
  });

  it.each([1, 2] as const)('publishes from a present empty v%s registry without changing its version', async registryFormatVersion => {
    const fixture = await createFixture(kind, {
      state: 'rootPublished', published: true, firstWorkspace: true, registryFormatVersion,
    });
    await expect(fixture.recovery.recover()).resolves.toBe('completedPublication');
    expect(await fixture.registry.read()).toEqual({ formatVersion: registryFormatVersion,
      activeWorkspaceId: registryFormatVersion === 1 ? fixture.targetEntry.workspaceId : null,
      workspaces: [fixture.targetEntry],
    });
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

  it.each([false, true])('keeps failed terminal removal restartable without republishing (duplicate label: %s)', async (duplicateLabel) => {
    const fixture = await createFixture(kind, { state: 'rootPublished', published: true, duplicateLabel });
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
