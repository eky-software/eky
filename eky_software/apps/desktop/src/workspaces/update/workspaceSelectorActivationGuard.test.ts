import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { WorkspaceSelectorSwitchSelection } from '../switch/workspaceSelectorSwitchSelection.js';
import { createWorkspaceSelectorSwitchJournal, createWorkspaceSelectorSwitchRegistryVariants } from '../switch/workspaceSelectorSwitchState.js';
import { createWorkspaceSwitchJournalPaths, serializeVersionedWorkspaceSwitchJournal, WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import {
  createSwitchRegistry, TEST_SWITCH_CREATED_AT, TEST_SWITCH_OPERATION_ID,
  TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID,
} from '../switch/workspaceSwitchTestSupport.js';
import { WorkspaceActivationMigrationGuard } from './workspaceActivationMigrationGuard.js';
import { WorkspaceActivationMigrationCoordinator } from './workspaceActivationMigrationCoordinator.js';
import { WorkspaceActivationMigrationInspector } from './workspaceActivationMigrationInspector.js';
import { WorkspaceActivationMigrationStartup } from './workspaceActivationMigrationStartup.js';

const variants = createWorkspaceSelectorSwitchRegistryVariants({
  ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId: null,
}, TEST_TARGET_WORKSPACE_ID);
const prepared = createWorkspaceSelectorSwitchJournal(
  variants.before, TEST_TARGET_WORKSPACE_ID, TEST_SWITCH_OPERATION_ID, TEST_SWITCH_CREATED_AT,
);
const selected = { ...prepared, state: 'targetSelected' as const };
const input = {
  operationId: TEST_SWITCH_OPERATION_ID, sourceWorkspaceId: null,
  targetWorkspaceId: TEST_TARGET_WORKSPACE_ID, expectedProfileId: 'b'.repeat(64),
};
const recoveryCode = { code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED' };

it('proves exact source-null selection with real stores and never repairs slots', async test => {
  const f = await fixture(test);
  const before = await f.snapshot();
  const proof = await f.guard.prove(input);
  expect(proof).toMatchObject({ sourceWorkspaceId: null, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID, profileId: input.expectedProfileId });
  await f.guard.reprove(proof);
  expect(await f.snapshot()).toEqual(before);
  expect(f.legacyRegistryRead).not.toHaveBeenCalled();
  expect(f.legacyJournalRead).not.toHaveBeenCalled();
});

it('refuses source-null input without explicit startup authority', async () => {
  const read = vi.fn();
  const guard = new WorkspaceActivationMigrationGuard({ read }, { read });
  await expect(guard.prove(input)).rejects.toMatchObject(recoveryCode);
  expect(read).not.toHaveBeenCalled();
});

it.for([
  { ...input, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { ...input, targetWorkspaceId: TEST_SOURCE_WORKSPACE_ID },
  { ...input, expectedProfileId: 'a'.repeat(64) },
  { ...input, expectedProfileId: 'invalid' },
  { ...input, sourceWorkspaceId: TEST_SOURCE_WORKSPACE_ID },
])('rejects an initially wrong operation, target, lineage or source %#', async (request, test) => {
  const f = await fixture(test);
  await expect(f.guard.prove(request)).rejects.toMatchObject(recoveryCode);
  expect(f.readRegistrySlots).not.toHaveBeenCalled();
  expect(f.readJournalSlots).not.toHaveBeenCalled();
  expect(f.legacyRegistryRead).not.toHaveBeenCalled();
});

it.for(['registry', 'journal'] as const)('rejects changed %s bytes and preserves them', async (kind, test) => {
  const f = await fixture(test);
  const proof = await f.guard.prove(input);
  const path = kind === 'registry' ? f.registryPath : f.journalPaths.currentPath;
  const bytes = kind === 'registry'
    ? serializeWorkspaceRegistry({ ...variants.selected, workspaces: variants.selected.workspaces.map((entry, i) =>
      i === 0 ? { ...entry, workspaceLabel: 'Changed neighbour' } : entry) })
    : serializeVersionedWorkspaceSwitchJournal({ ...selected, state: 'recoveryRequired' });
  await writeFile(path, bytes);
  const before = await f.snapshot();
  await expect(f.guard.reprove(proof)).rejects.toMatchObject(recoveryCode);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['registry', 'journal'] as const)('rejects identical %s bytes on a replacement file', async (kind, test) => {
  const f = await fixture(test);
  const proof = await f.guard.prove(input);
  const path = kind === 'registry' ? f.registryPath : f.journalPaths.currentPath;
  const bytes = await readFile(path);
  await rename(path, path + '.retained');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  await expect(f.guard.reprove(proof)).rejects.toMatchObject(recoveryCode);
  expect(await readFile(path)).toEqual(bytes);
  expect(await readFile(path + '.retained')).toEqual(bytes);
});

it.for(['registry.next', 'registry.backup', 'journal.next', 'journal.backup'] as const)(
  'does not repair newly appeared %s', async (slot, test) => {
    const f = await fixture(test);
    const proof = await f.guard.prove(input);
    const [kind, suffix] = slot.split('.');
    const path = kind === 'registry' ? f.registryPath + '.' + suffix
      : suffix === 'next' ? f.journalPaths.nextPath : f.journalPaths.backupPath;
    await writeFile(path, kind === 'registry' ? serializeWorkspaceRegistry(variants.selected)
      : serializeVersionedWorkspaceSwitchJournal(selected), { flag: 'wx', mode: 0o600 });
    const before = await f.snapshot();
    await expect(f.guard.reprove(proof)).rejects.toMatchObject(recoveryCode);
    expect(await f.snapshot()).toEqual(before);
  },
);

it.for(['prepared', 'rollbackSelected', 'recoveryRequired'] as const)(
  'rejects an initially persisted %s state without repair', async (state, test) => {
    const f = await fixture(test);
    await writeFile(f.journalPaths.currentPath, serializeVersionedWorkspaceSwitchJournal({ ...prepared, state }));
    const guard = await f.createGuard();
    const before = await f.snapshot();
    await expect(guard.prove(input)).rejects.toMatchObject(recoveryCode);
    expect(await f.snapshot()).toEqual(before);
  },
);

it.for(['registry', 'journal'] as const)('rejects initially unsettled %s slots', async (kind, test) => {
  const f = await fixture(test);
  const path = kind === 'registry' ? f.registryPath : f.journalPaths.currentPath;
  const backup = kind === 'registry' ? f.registryPath + '.backup' : f.journalPaths.backupPath;
  await writeFile(backup, await readFile(path), { flag: 'wx', mode: 0o600 });
  const guard = await f.createGuard();
  const before = await f.snapshot();
  await expect(guard.prove(input)).rejects.toMatchObject(recoveryCode);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['before', 'registry', 'journal'] as const)('rejects authority lost at %s read', async (phase, test) => {
  const f = await fixture(test);
  if (phase === 'before') f.current = false;
  if (phase === 'registry') f.readRegistrySlots.mockImplementationOnce(async () => {
    const slots = await f.registry.inspectSlots(); f.current = false; return slots;
  });
  if (phase === 'journal') f.readJournalSlots.mockImplementationOnce(async () => {
    const slots = await f.journal.inspectSlots(); f.current = false; return slots;
  });
  const before = await f.snapshot();
  await expect(f.guard.prove(input)).rejects.toMatchObject(recoveryCode);
  expect(await f.snapshot()).toEqual(before);
});

it('rechecks registry changed while journal was read', async test => {
  const f = await fixture(test);
  f.readJournalSlots.mockImplementationOnce(async () => {
    const slots = await f.journal.inspectSlots();
    await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
    return slots;
  });
  await expect(f.guard.prove(input)).rejects.toMatchObject(recoveryCode);
  expect(await f.registry.inspect()).toEqual(variants.before);
});

it('rechecks journal changed while registry was rechecked', async test => {
  const f = await fixture(test);
  f.readRegistrySlots.mockImplementationOnce(() => f.registry.inspectSlots())
    .mockImplementationOnce(async () => {
      const slots = await f.registry.inspectSlots();
      await writeFile(f.journalPaths.currentPath, serializeVersionedWorkspaceSwitchJournal({ ...selected, state: 'recoveryRequired' }));
      return slots;
    });
  await expect(f.guard.prove(input)).rejects.toMatchObject(recoveryCode);
});

it('does not transfer a proof to another guard or accept a fabricated proof', async test => {
  const f = await fixture(test);
  const proof = await f.guard.prove(input);
  await expect(f.guard.reprove({ ...proof })).rejects.toMatchObject(recoveryCode);
  const nextGuard = await f.createGuard();
  await expect(nextGuard.reprove(proof)).rejects.toMatchObject(recoveryCode);
});

it('does not let callers mutate captured selections or issued proof bytes', async test => {
  const f = await fixture(test);
  f.selection.registrySlots.current!.bytes.fill(0);
  f.selection.journalSlots.current!.bytes.fill(0);
  const proof = await f.guard.prove(input);
  proof.registrySnapshot.fill(0);
  await expect(f.guard.reprove(proof)).rejects.toMatchObject(recoveryCode);
});

it('captures input before an asynchronous observation', async test => {
  const f = await fixture(test);
  const request = { ...input };
  f.readRegistrySlots.mockImplementationOnce(async () => {
    request.expectedProfileId = 'c'.repeat(64);
    return f.registry.inspectSlots();
  });
  expect((await f.guard.prove(request)).profileId).toBe(input.expectedProfileId);
});

it('rejects asynchronous authority instead of awaiting a new permission', async test => {
  const f = await fixture(test);
  const guard = await f.createGuard(async () => undefined);
  await expect(guard.prove(input)).rejects.toMatchObject(recoveryCode);
  expect(f.readRegistrySlots).not.toHaveBeenCalled();
});

it('preserves activation evidence when selector authority expires during lease acquisition', async test => {
  const f = await fixture(test);
  const proof = await f.guard.prove(input);
  const activationRead = vi.fn(async () => undefined);
  const discard = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => { throw new Error('unexpected rollback'); });
  const removeStaging = vi.fn(async () => undefined);
  const recover = vi.fn(async () => 'relaunchRequired' as const);
  const requireRecovery = vi.fn(async () => 'recoveryRequired' as const);
  const requestRelaunch = vi.fn();
  const stop = vi.fn(async () => undefined);
  const absent = vi.fn(async () => undefined);
  const unexpected = vi.fn(async () => { throw new Error('unexpected forward action'); });
  const coordinator = new WorkspaceActivationMigrationCoordinator({
    guard: f.guard, userDataRoot: f.root,
    maintenanceLease: { async acquire() { f.current = false; return { release: unexpected }; } },
    workspaceRuntimeAbsence: { assertNoActiveWorkspaceRuntime: absent },
    activationAuthorityFactory: { create: () => ({
      journalStore: { read: activationRead }, transaction: {
        accept: unexpected, prepare: unexpected, advanceToValidation: unexpected, rollback,
        clearRolledBack: unexpected, commitAcceptance: unexpected, clearAccepted: unexpected,
        assertForwardRecoveryState: unexpected, readForwardRecoverySources: unexpected,
      },
    }) },
    backupCandidate: { migrate: unexpected, validateAndMaterialize: unexpected, validatePublished: unexpected },
    recoveryPoint: { createAndStage: unexpected, removeStaging },
    rootStore: { prepareCandidate: unexpected, inspectCandidate: unexpected, discardBeforeActivation: discard, removeImportStaging: unexpected },
    sourceRecovery: { recoverFromFailure: recover, requireRecovery }, requestRelaunch,
  });
  const before = await f.snapshot();
  await expect(coordinator.migrateAndActivate({ proof, expectedSourceMigrationChainIdentity: 'c'.repeat(64),
    stopTargetStartupRuntime: stop })).rejects.toMatchObject(recoveryCode);
  expect(stop).toHaveBeenCalledOnce();
  expect(absent).toHaveBeenCalledOnce();
  expect(activationRead).not.toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
  expect(rollback).not.toHaveBeenCalled();
  expect(removeStaging).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
  expect(requireRecovery).not.toHaveBeenCalled();
  expect(requestRelaunch).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['current', 'compatiblePending'] as const)(
  'passes real slot proof through existing startup and inspector for %s', async (status, test) => {
    const f = await startupFixture(test, status);
    const before = await f.snapshot();
    await expect(f.startup.prepareBeforeBackend()).resolves.toMatchObject({
      status: status === 'current' ? 'notRequired' : 'migrationRequired',
    });
    const stopStartupRuntime = vi.fn(async () => undefined);
    await expect(f.startup.beforeMigrations({
      profileState: 'existing', appliedMigrationCount: 38,
      pendingMigrationCount: status === 'current' ? 0 : 2,
      migrationChainIdentity: 'c'.repeat(64),
    }, { stopStartupRuntime })).resolves.toBe(status === 'current' ? 'notRequired' : 'relaunchRequired');
    expect(f.startMigrationInspection).toHaveBeenCalledOnce();
    expect(f.stopInspection).toHaveBeenCalled();
    expect(f.migrateAndActivate).toHaveBeenCalledTimes(status === 'current' ? 0 : 1);
    expect(stopStartupRuntime).toHaveBeenCalledTimes(status === 'current' ? 0 : 1);
    expect(f.legacyRegistryRead).not.toHaveBeenCalled();
    expect(f.legacyJournalRead).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);

it.for(['selection', 'generation', 'inspectionExit'] as const)(
  'rejects %s failure in the joined guard and inspection path', async (fault, test) => {
    const f = await startupFixture(test, 'compatiblePending');
    if (fault === 'selection') {
      f.inspectStoppedMigrationInspection.mockImplementationOnce(async () => {
        await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
        return { appliedMigrationCount: 38, pendingMigrationCount: 2, status: 'compatiblePending' };
      });
    }
    if (fault === 'generation') {
      f.inspectStoppedMigrationInspection.mockImplementationOnce(async () => {
        f.current = false;
        return { appliedMigrationCount: 38, pendingMigrationCount: 2, status: 'compatiblePending' };
      });
    }
    if (fault === 'inspectionExit') f.stopInspection.mockResolvedValue(false);
    await expect(f.startup.prepareBeforeBackend()).rejects.toMatchObject({
      code: fault === 'inspectionExit' ? 'WORKSPACE_ACTIVATION_MIGRATION_FAILED' : recoveryCode.code,
    });
    expect(f.migrateAndActivate).not.toHaveBeenCalled();
    expect(f.validateHistoricalPublished).not.toHaveBeenCalled();
    expect(f.rejectInvalidTarget).not.toHaveBeenCalled();
    expect(await readFile(f.journalPaths.currentPath)).toEqual(Buffer.from(serializeVersionedWorkspaceSwitchJournal(selected)));
  },
);

async function startupFixture(test: TestContext, status: 'current' | 'compatiblePending') {
  const f = await fixture(test);
  const workspaceRoot = join(f.root, 'workspaces', TEST_TARGET_WORKSPACE_ID);
  await mkdir(join(workspaceRoot, 'runtime', 'data'), { recursive: true, mode: 0o700 });
  const stopInspection = vi.fn(async () => true);
  const inspectStoppedMigrationInspection = vi.fn(async () => ({
    appliedMigrationCount: 38, pendingMigrationCount: status === 'current' ? 0 : 2, status,
  }));
  const startMigrationInspection = vi.fn(async () => ({ inspectStoppedMigrationInspection, stopAndProveHandlesClosed: stopInspection }));
  const validateHistoricalPublished = vi.fn(async () => ({
    actorId: 'local-owner' as const, artifactRootHealth: 'ready' as const, companyId: 'dev-company',
    databaseHealth: 'healthy' as const, foreignKeyHealth: 'healthy' as const, handlesClosed: true as const,
    lineageIdentity: { formatVersion: 1 as const, profileId: input.expectedProfileId },
    migrationChainIdentity: 'c'.repeat(64), migrationState: 'compatiblePending' as const,
  }));
  const migrateAndActivate = vi.fn(async (request: Parameters<WorkspaceActivationMigrationCoordinator['migrateAndActivate']>[0]) => {
    await f.guard.reprove(request.proof);
    await request.stopTargetStartupRuntime();
    return 'relaunchRequired' as const;
  });
  const rejectInvalidTarget = vi.fn(async () => 'relaunchRequired' as const);
  const startup = new WorkspaceActivationMigrationStartup({
    activeWorkspace: {
      mode: 'targetValidation', workspaceId: TEST_TARGET_WORKSPACE_ID, workspaceRoot, rejectInvalidTarget,
      switchContext: { ...input, targetProfileId: input.expectedProfileId },
    },
    guard: f.guard, inspector: new WorkspaceActivationMigrationInspector({ startMigrationInspection }),
    historicalValidation: { validateHistoricalPublished }, coordinator: { migrateAndActivate },
    markTargetRuntimeStopped() {}, requestRelaunch() {}, userDataRoot: f.root,
    publishedValidationInput: {
      databaseFilePath: join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
      artifactRoot: join(workspaceRoot, 'runtime', 'storage', 'invoices'),
      expectedProfileId: input.expectedProfileId, publishedRoot: workspaceRoot,
    },
  });
  return Object.assign(f, { startup, startMigrationInspection, inspectStoppedMigrationInspection,
    stopInspection, migrateAndActivate, validateHistoricalPublished, rejectInvalidTarget });
}

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-activation-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const journalPaths = createWorkspaceSwitchJournalPaths(root);
  await mkdir(journalPaths.directoryPath, { mode: 0o700 });
  await writeFile(registryPath, serializeWorkspaceRegistry(variants.selected), { flag: 'wx', mode: 0o600 });
  await writeFile(journalPaths.currentPath, serializeVersionedWorkspaceSwitchJournal(selected), { flag: 'wx', mode: 0o600 });
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const journal = new WorkspaceSwitchJournalStore(root);
  let current = true;
  const assertAuthority = () => { if (!current) throw new Error('authority expired'); };
  const legacyRegistryRead = vi.fn(() => registry.read());
  const legacyJournalRead = vi.fn(() => journal.read());
  const readRegistrySlots = vi.fn(() => registry.inspectSlots());
  const readJournalSlots = vi.fn(() => journal.inspectSlots());
  const selection: WorkspaceSelectorSwitchSelection = {
    registrySlots: await registry.inspectSlots(), journalSlots: await journal.inspectSlots(),
    readRegistrySlots, assertAuthority,
  };
  const create = (captured: WorkspaceSelectorSwitchSelection) => new WorkspaceActivationMigrationGuard(
    { read: legacyRegistryRead }, { read: legacyJournalRead }, { selection: captured, readJournalSlots },
  );
  return {
    root, registry, journal, registryPath, journalPaths, legacyRegistryRead, legacyJournalRead,
    readRegistrySlots, readJournalSlots, selection, guard: create(selection),
    get current() { return current; }, set current(value: boolean) { current = value; },
    async createGuard(authority: () => void = assertAuthority) {
      return create({ registrySlots: await registry.inspectSlots(), journalSlots: await journal.inspectSlots(),
        readRegistrySlots, assertAuthority: authority });
    },
    async snapshot() {
      return Promise.all([registryPath, registryPath + '.next', registryPath + '.backup',
        journalPaths.currentPath, journalPaths.nextPath, journalPaths.backupPath].map(async path => {
        try { return await readFile(path); }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
      }));
    },
  };
}
