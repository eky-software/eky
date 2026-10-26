import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import { createDesktopDeferredBusinessStartup } from '../../main/desktopDeferredBusinessStartup.js';
import { planDeferredBusinessLocalUpdateState, type DeferredBusinessLocalUpdateState } from '../../update/deferredBusinessLocalUpdateState.js';
import { AcceptedBuildMetadataStore, acceptedBuildMetadataFileName } from '../../update/acceptedBuildMetadataStore.js';
import { DirectSetupMigrationRecoveryStore, directSetupMigrationRecoveryFileName } from '../../update/directSetupMigrationRecoveryStore.js';
import { UpdateJournalStore, updateJournalFileName } from '../../update/updateJournalStore.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { createWorkspaceFirstStartMigrationComposition, type WorkspaceFirstStartMigrationCompositionOptions } from './workspaceFirstStartMigrationComposition.js';
import { createWorkspaceSelectorSwitchJournal } from '../switch/workspaceSelectorSwitchState.js';
import { resolveWorkspaceSelectorSwitchStartup, type WorkspaceSelectorSwitchSettlement } from '../switch/workspaceSelectorSwitchStartup.js';
import { createWorkspaceSwitchJournalPaths, WorkspaceSwitchJournalStore, serializeVersionedWorkspaceSwitchJournal } from '../switch/workspaceSwitchJournal.js';
import { serializeWorkspaceFirstStartMigrationJournal, validateWorkspaceFirstStartMigrationJournal } from './workspaceFirstStartMigrationJournalCodec.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from './workspaceFirstStartMigrationJournalPaths.js';
import { WorkspaceFirstStartMigrationJournalStore } from './workspaceFirstStartMigrationJournalStore.js';
import type { WorkspaceFirstStartMigrationJournalV1 } from './workspaceFirstStartMigrationJournalTypes.js';
import { calculateWorkspaceRegistrySha256, markPassiveWorkspacesRecoveryRequired } from './workspaceFirstStartMigrationRegistryTransitions.js';
import { WorkspaceFirstStartMigrationTransitionCoordinator } from './workspaceFirstStartMigrationTransitionCoordinator.js';
import { createWorkspaceFirstStartSelectedPersistence } from './workspaceFirstStartSelectedPersistence.js';
import { WorkspaceMigrationInventoryCoordinator } from './workspaceMigrationInventoryCoordinator.js';

vi.mock('electron', () => ({ utilityProcess: { fork() { throw new Error('UNEXPECTED_PROCESS'); } } }));

const at = '2026-10-25T12:00:00.000Z';
const source = { formatVersion: 1 as const, releaseChannel: 'pilot' as const,
  appVersion: '0.2.0', buildRevision: 'a'.repeat(40), acceptedAt: at };
const target = { ...source, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) };
const selector = createSelectorAcceptedBuildMetadata(source, target);
const activeId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const passiveId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const operationId = '33333333-3333-4333-8333-333333333333';
const context = { activeWorkspaceId: activeId, workspaceState: 'publishedRegistry' as const };
const absentSlots = { current: undefined, next: undefined, backup: undefined };

it('uses selected persistence in the real W6 composition through preparation, transition and completion', async test => {
  const f = await fixture(test);
  const inventory = vi.spyOn(WorkspaceMigrationInventoryCoordinator.prototype, 'inspect').mockResolvedValue({
    activeWorkspaceId: activeId, entries: [
      { workspaceId: activeId, isActive: true, appliedMigrationCount: 38, pendingMigrationCount: 1, status: 'compatiblePending' },
      { workspaceId: passiveId, isActive: false, appliedMigrationCount: 0, pendingMigrationCount: 0, status: 'invalidHistory' },
    ],
  });
  test.onTestFinished(() => inventory.mockRestore());
  await mkdir(join(f.root, 'backend/dist/database/migrations'), { recursive: true });
  await mkdir(join(f.root, 'desktop-runtime/runtime'), { recursive: true });
  await writeFile(join(f.root, 'desktop-runtime/runtime/workspaceCandidateRunner.js'), 'synthetic');
  const oldWrite = vi.spyOn(WorkspaceFirstStartMigrationJournalStore.prototype, 'write');
  const selectedWrite = vi.spyOn(WorkspaceFirstStartMigrationJournalStore.prototype, 'writeSelected');
  test.onTestFinished(() => { oldWrite.mockRestore(); selectedWrite.mockRestore(); });
  const subject = f.composition();
  expect(await subject.recoverBeforeWorkspaceResolution()).toBe('noJournal');
  expect(await subject.prepareBeforeBackend(context)).toBe('prepared');
  await subject.assertDeferredBusinessReady('beforeMigrations');
  await expect(subject.assertDeferredBusinessReady('beforeAcceptance')).rejects.toThrow();
  expect(f.guard.bindPreparation).toHaveBeenCalledOnce();
  const prepared = (await f.journal.inspect())!.value;
  expect(prepared.operationId).toBe(operationId);
  expect(prepared.passiveRecoveryWorkspaceIds).toEqual([passiveId]);
  expect(oldWrite).not.toHaveBeenCalled();
  await subject.transitionRegistryAfterActiveWorkspaceAcceptance();
  await subject.assertDeferredBusinessReady('beforeAcceptance');
  await expect(subject.assertDeferredBusinessReady('beforeMigrations')).rejects.toThrow();
  await expect(subject.completeAfterTargetAcceptance()).rejects.toThrow();
  expect((await f.journal.inspect())?.value.state).toBe('registryTransitioned');
  // Business acceptance is controlled here; real FirstStart/native proof is separate.
  await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
  await subject.completeAfterTargetAcceptance();
  await expect(subject.assertDeferredBusinessReady('beforeAcceptance')).rejects.toThrow();
  expect(await f.journal.inspect()).toBeUndefined();
  expect(await f.registry.inspect()).toEqual(f.transitioned);
  expect(selectedWrite).toHaveBeenCalledTimes(2);
});

it.for(['prepared', 'registryTransitioned'] as const)('recovers the exact %s operation and registry through the existing coordinator', async (state, test) => {
  const f = await fixture(test);
  await f.registry.write(f.transitioned);
  await f.seedJournal({ ...f.prepared, state });
  const ports = await f.ports();
  const coordinator = new WorkspaceFirstStartMigrationTransitionCoordinator({ ...ports, acceptedBuild: f.accepted,
    deferredBusiness: { acceptedBuild: selector, assertCurrent: f.guard.assertExternalSelection } });
  expect(await coordinator.recover({ appVersion: target.appVersion, buildRevision: target.buildRevision }))
    .toEqual({ kind: 'recoveredSource', operationId });
  expect(await f.registry.inspect()).toEqual(f.initial);
  expect(await f.journal.inspect()).toBeUndefined();
});

it('settles only the admitted next-only preparation with its original file identity', async test => {
  const f = await fixture(test);
  await f.seedJournal(f.prepared, 'next');
  const before = (await f.journal.inspectSlots()).next!;
  const ports = await f.ports();
  expect(await ports.journal.read()).toEqual(f.prepared);
  expect((await f.journal.inspect())!.identity?.ino).toBe(before.identity?.ino);
  expect(f.guard.bindPreparation).not.toHaveBeenCalled();
});

it('renews the terminal proof without recursively reading the journal being removed', async test => {
  const f = await fixture(test);
  await f.seedJournal(f.prepared);
  const ports = await f.ports();
  const selected = (await ports.journal.inspect())!;
  const terminal = vi.fn(async () => { expect(await ports.registry.inspect()).toEqual(f.initial); });
  await ports.journal.discardPrepared(operationId, { selected, assertCurrent: f.guard.assertCurrent, assertExternalSelection: terminal });
  expect(terminal).toHaveBeenCalled();
  expect(await ports.journal.inspect()).toBeUndefined();
  expect(await f.registry.inspect()).toEqual(f.initial);
});

it.for(['registry', 'journal'] as const)('rejects a same-byte %s substitution without adopting it', async (owner, test) => {
  const f = await fixture(test);
  await f.seedJournal(f.prepared);
  const ports = await f.ports();
  const path = owner === 'registry' ? f.registryPath : f.journalPath;
  const bytes = await readFile(path);
  await rename(path, `${path}.retained`);
  await writeFile(path, bytes, { flag: 'wx' });
  await expect(ports.journal.write({ ...f.prepared, state: 'registryTransitioned' })).rejects.toThrow();
  expect(await readFile(path)).toEqual(bytes);
  expect(await readFile(`${path}.retained`)).toEqual(bytes);
  expect((await f.journal.inspect())!.value.state).toBe('prepared');
});

it.for(['journal', 'registry'] as const)('rejects a changed %s returned after publication and seals the failed owner', async (owner, test) => {
  const f = await fixture(test);
  await f.seedJournal(f.prepared);
  const ports = await f.ports();
  const path = owner === 'registry' ? f.registryPath : f.journalPath;
  const replace = async () => {
    const bytes = await readFile(path);
    await rename(path, `${path}.retained`);
    await writeFile(path, bytes, { flag: 'wx' });
  };
  if (owner === 'journal') {
    const write = f.journal.writeSelected.bind(f.journal);
    vi.spyOn(f.journal, 'writeSelected').mockImplementationOnce(async (...args) => { const id = await write(...args); await replace(); return id; });
    await expect(ports.journal.write({ ...f.prepared, state: 'registryTransitioned' })).rejects.toThrow();
  } else {
    const write = f.registry.writeSelected.bind(f.registry);
    vi.spyOn(f.registry, 'writeSelected').mockImplementationOnce(async (...args) => { const id = await write(...args); await replace(); return id; });
    await expect(ports.registry.write(f.transitioned)).rejects.toThrow();
  }
  const bytes = await readFile(path);
  await expect(ports.journal.discardPrepared(operationId)).rejects.toThrow();
  expect(await readFile(path)).toEqual(bytes);
});

it('binds the validated preparation before the first journal mutation and rejects a denied binding', async test => {
  const f = await fixture(test);
  f.guard.bindPreparation.mockImplementationOnce(async journal => {
    expect(journal).toEqual(f.prepared);
    expect(await f.journal.inspect()).toBeUndefined();
    throw new Error('BINDING_REJECTED');
  });
  const ports = await f.ports();
  await expect(ports.journal.write(f.prepared)).rejects.toThrow('BINDING_REJECTED');
  expect(await f.journal.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
  expect(await f.registry.inspect()).toEqual(f.initial);
});

it.for(['authority', 'external'] as const)('captures the original %s callback before work', async (kind, test) => {
  const f = await fixture(test);
  await f.seedJournal(f.prepared);
  const ports = await f.ports();
  f.state[kind] = false;
  if (kind === 'authority') f.guard.assertCurrent = () => {};
  else f.guard.assertExternalSelection = async () => {};
  await expect(ports.journal.discardPrepared(operationId)).rejects.toThrow();
  expect((await f.journal.inspect())!.value).toEqual(f.prepared);
});

it('retains the first mutation failure and never retries its write or removes its evidence', async test => {
  const f = await fixture(test);
  const ports = await f.ports();
  const first = new Error('PUBLICATION_ACK_LOST');
  const write = f.journal.writeSelected.bind(f.journal);
  const spy = vi.spyOn(f.journal, 'writeSelected').mockImplementationOnce(async (...args) => { await write(...args); throw first; });
  await expect(ports.journal.write(f.prepared)).rejects.toBe(first);
  await expect(ports.journal.write(f.prepared)).rejects.toThrow();
  await expect(ports.journal.discardPrepared(operationId)).rejects.toThrow();
  expect(spy).toHaveBeenCalledOnce();
  expect((await f.journal.inspect())!.value).toEqual(f.prepared);
});

it.for(['next', 'backup'] as const)('does not repair unexpected accepted-build %s evidence in deferred composition', async (slot, test) => {
  const f = await fixture(test);
  const subject = f.composition();
  const path = join(f.root, acceptedBuildMetadataFileName);
  const original = await readFile(path);
  await writeFile(`${path}.${slot}`, original, { flag: 'wx' });
  await expect(subject.recoverBeforeWorkspaceResolution()).rejects.toThrow();
  expect(await readFile(path)).toEqual(original);
  expect(await readFile(`${path}.${slot}`)).toEqual(original);
});

it.for(['startup', 'terminal'] as const)('rejects a Promise-returning %s authority before mutating', async (kind, test) => {
  const f = await fixture(test);
  await f.seedJournal(f.prepared);
  if (kind === 'startup') f.guard.assertCurrent = async () => {};
  const ports = await f.ports();
  const selected = (await f.journal.inspect())!;
  await expect(ports.journal.discardPrepared(operationId, {
    selected, assertCurrent: kind === 'terminal' ? async () => {} : () => {}, async assertExternalSelection() {},
  })).rejects.toThrow();
  expect((await f.journal.inspect())!.value).toEqual(f.prepared);
});

it.for((['registry', 'journal'] as const).flatMap(owner =>
  (['authority', 'external'] as const).map(fault => ({ owner, fault }))))(
  'seals a rejected $owner read after temporary $fault loss', async ({ owner, fault }, test) => {
    const f = await fixture(test);
    const ports = await f.ports();
    f.state[fault] = false;
    await expect(ports[owner].read()).rejects.toThrow();
    f.state[fault] = true;
    await expect(ports.journal.write(f.prepared)).rejects.toThrow();
    expect(await f.journal.inspect()).toBeUndefined();
    expect(await f.registry.inspect()).toEqual(f.initial);
  },
);

it('carries real switch recovery and acceptance receipts into main and W6 without recapturing identity', async test => {
  const f = await fixture(test);
  const switchStore = new WorkspaceSwitchJournalStore(f.root);
  const switchPaths = createWorkspaceSwitchJournalPaths(f.root);
  const switchJournal = createWorkspaceSelectorSwitchJournal({ ...f.initial, formatVersion: 2, activeWorkspaceId: null },
    activeId, '44444444-4444-4444-8444-444444444444', at);
  await mkdir(switchPaths.directoryPath, { recursive: true });
  await writeFile(switchPaths.currentPath, serializeVersionedWorkspaceSwitchJournal(switchJournal));
  await rename(f.registryPath, f.registryPath + '.backup');
  const absent = { current: undefined, next: undefined, backup: undefined };
  const state: DeferredBusinessLocalUpdateState = {
    metadata: await f.accepted.inspectSlots(), legacyMetadata: absent,
    updateJournal: absent, legacyUpdateJournal: absent, directSetupRecovery: absent,
    registry: await f.registry.inspectSlots(), switchJournal: await switchStore.inspectSlots(),
    firstStartJournal: await f.journal.inspectSlots(), runningBuild: target,
  };
  const main = createDesktopDeferredBusinessStartup({
    prepared: { ...planDeferredBusinessLocalUpdateState(state), selectedState: state }, assertCurrent: f.guard.assertCurrent,
    async inspectExternal(includeMetadata) {
      return { ...(includeMetadata ? { metadata: await f.accepted.inspectSlots() } : {}),
        legacyMetadata: absent, updateJournal: absent, legacyUpdateJournal: absent, directSetupRecovery: absent,
        switchJournal: await switchStore.inspectSlots() };
    },
  });
  const w6 = f.composition(main.authority, main.operationIdFactory);
  await expect(w6.recoverBeforeWorkspaceResolution()).resolves.toBe('noJournal');
  const startup = await resolveWorkspaceSelectorSwitchStartup({
    registry: f.registry, journal: switchStore,
    selection: { registrySlots: state.registry, journalSlots: state.switchJournal,
      readRegistrySlots: () => f.registry.inspectSlots(), assertAuthority: f.guard.assertCurrent },
    authority: { assertCurrent: f.guard.assertCurrent,
      admitSelection: main.admitSelectorSelection,
      didSettleSelection: receipt => main.settleSelectorSelection(receipt, w6),
      // Native/process terminal proof is intentionally controlled in this owner-chain test.
      async proveTerminal() { return { assertCurrent: f.guard.assertCurrent }; } },
  });
  if (startup.mode === 'selector') throw new Error('UNEXPECTED_SELECTOR');
  expect((await f.registry.inspectSlots()).current?.identity?.ino).toBe(state.registry.backup?.identity?.ino);
  const inventory = vi.spyOn(WorkspaceMigrationInventoryCoordinator.prototype, 'inspect').mockResolvedValue({
    activeWorkspaceId: activeId, entries: [
      { workspaceId: activeId, isActive: true, appliedMigrationCount: 38, pendingMigrationCount: 1, status: 'compatiblePending' },
      { workspaceId: passiveId, isActive: false, appliedMigrationCount: 0, pendingMigrationCount: 0, status: 'invalidHistory' },
    ],
  });
  test.onTestFinished(() => inventory.mockRestore());
  await mkdir(join(f.root, 'backend/dist/database/migrations'), { recursive: true });
  await mkdir(join(f.root, 'desktop-runtime/runtime'), { recursive: true });
  await writeFile(join(f.root, 'desktop-runtime/runtime/workspaceCandidateRunner.js'), 'synthetic');
  await expect(w6.prepareBeforeBackend(context)).resolves.toBe('prepared');
  await main.firstStartAuthority(w6, 'c'.repeat(64));
  await startup.accept('a'.repeat(64));
  await main.assertCurrent();
  await w6.transitionRegistryAfterActiveWorkspaceAcceptance();
  await w6.assertDeferredBusinessReady('beforeAcceptance');
  expect(await f.registry.inspect()).toEqual(f.transitioned);
  expect((await switchStore.inspectSlots()).current).toBeUndefined();
  // Real FirstStart/native validation is separate; this controlled publication
  // checks the complete main/W6 handoff against the persisted metadata record.
  await main.accept({ async acceptAfterBackendReady() {
    await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
    return (await f.accepted.inspectSlots()).current;
  } }, w6);
  await w6.completeAfterTargetAcceptance();
  await main.assertCurrent();
  expect(await f.journal.inspect()).toBeUndefined();
});

it.for(['semanticChange', 'wrongOriginal', 'foreignIdentity', 'ownerLost'] as const)(
  'rejects %s during the narrow registry settlement and seals the persistence owner', async (fault, test) => {
    const f = await fixture(test);
    await rename(f.registryPath, f.registryPath + '.backup');
    const before = await f.registry.inspectSlots();
    const ports = await f.ports();
    await f.registry.recoverSelected({
      expectedSlots: { current: undefined, next: undefined, backup: before.backup!.bytes },
      expectedIdentities: { current: undefined, next: undefined, backup: before.backup!.identity },
      assertAuthority: f.guard.assertCurrent, assertExternalSelection: f.guard.assertExternalSelection,
    });
    const after = await f.registry.inspectSlots();
    const receipt: WorkspaceSelectorSwitchSettlement = { phase: 'startup',
      before: { registrySlots: structuredClone(before), journalSlots: absentSlots },
      after: { registrySlots: structuredClone(after), journalSlots: absentSlots }, async assertCurrent() {} };
    if (fault === 'semanticChange') {
      await f.registry.write({ ...f.initial, activeWorkspaceId: null });
      Object.assign(receipt.after, { registrySlots: await f.registry.inspectSlots() });
    }
    if (fault === 'wrongOriginal') Object.assign(receipt.before, { registrySlots: after });
    if (fault === 'foreignIdentity') {
      const bytes = await readFile(f.registryPath);
      await rename(f.registryPath, f.registryPath + '.retained');
      await writeFile(f.registryPath, bytes, { flag: 'wx' });
    }
    if (fault === 'ownerLost') Object.assign(receipt, { async assertCurrent() { throw new Error('OWNER_LOST'); } });
    const bytes = await readFile(f.registryPath);
    await expect(ports.settleSelectorRegistry(receipt)).rejects.toThrow();
    await expect(ports.registry.read()).rejects.toThrow();
    expect(await readFile(f.registryPath)).toEqual(bytes);
    expect(await f.journal.inspect()).toBeUndefined();
  },
);

it('allows the registry handoff only once before W6 preparation and excludes cancellation while it is pending', async test => {
  const f = await fixture(test);
  const w6 = f.composition();
  await w6.recoverBeforeWorkspaceResolution();
  const slots = await f.registry.inspectSlots();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const receipt: WorkspaceSelectorSwitchSettlement = { phase: 'startup',
    before: { registrySlots: slots, journalSlots: absentSlots }, after: { registrySlots: slots, journalSlots: absentSlots },
    async assertCurrent() { entered(); await pending; } };
  const settled = w6.settleSelectorRegistry(receipt);
  await started;
  try {
    await expect(w6.prepareBeforeBackend(context)).rejects.toThrow();
    await expect(w6.cancelBeforeSelectorReturn({ assertCurrent() {}, async assertTerminal() {} })).rejects.toThrow();
  } finally { release(); }
  await settled;
  await expect(w6.settleSelectorRegistry(receipt)).rejects.toThrow();
});

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6-selected-composition-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const initial: LocalWorkspaceRegistry = { formatVersion: 2, activeWorkspaceId: activeId,
    workspaces: [activeId, passiveId].map((workspaceId, index) => ({ workspaceId,
      workspaceLabel: index === 0 ? 'Synthetic active' : 'Synthetic passive',
      lineageIdentity: { formatVersion: 1 as const, profileId: (index === 0 ? 'a' : 'b').repeat(64) },
      layoutVersion: 1 as const, lifecycleState: 'ready' as const, createdAt: at })) };
  await registry.write(initial);
  const transitioned = markPassiveWorkspacesRecoveryRequired(initial, activeId, [passiveId]);
  const journal = new WorkspaceFirstStartMigrationJournalStore({ userDataPath: root });
  const paths = createWorkspaceFirstStartMigrationJournalPaths(root);
  const accepted = new AcceptedBuildMetadataStore(join(root, acceptedBuildMetadataFileName));
  await accepted.write(selector);
  const prepared = validateWorkspaceFirstStartMigrationJournal({ formatVersion: 1, operationId, state: 'prepared',
    sourceBuild: { appVersion: source.appVersion, buildRevision: source.buildRevision },
    targetBuild: { appVersion: target.appVersion, buildRevision: target.buildRevision },
    activeWorkspaceId: activeId, passiveRecoveryWorkspaceIds: [passiveId],
    sourceRegistrySha256: calculateWorkspaceRegistrySha256(initial),
    transitionedRegistrySha256: calculateWorkspaceRegistrySha256(transitioned), createdAt: at, updatedAt: at });
  const state = { authority: true, external: true };
  const guard = { registry: await registry.inspectSlots(), journal: await journal.inspectSlots(),
    assertCurrent() { if (!state.authority) throw new Error('AUTHORITY_LOST'); },
    async assertExternalSelection() { if (!state.external) throw new Error('EXTERNAL_CHANGED'); },
    bindPreparation: vi.fn(async (_journal: Readonly<WorkspaceFirstStartMigrationJournalV1>) => {}),
  };
  return { root, registry, registryPath, journal, journalPath: paths.currentPath,
    accepted, initial, transitioned, prepared, state, guard,
    composition(deferred: WorkspaceFirstStartMigrationCompositionOptions['deferredBusiness'] = {
      acceptedBuild: selector, assertCurrent: guard.assertExternalSelection, persistence: guard,
    }, operationIdFactory = () => operationId) {
      return createWorkspaceFirstStartMigrationComposition({
        acceptedBuildStore: accepted, admission: 'exactAcceptedBuild',
        deferredBusiness: deferred,
        buildInfo: { schemaVersion: 1, appVersion: target.appVersion, buildRevision: target.buildRevision,
          buildCreatedAt: at, buildDirty: false },
        directSetupRecoveryStore: new DirectSetupMigrationRecoveryStore(join(root, directSetupMigrationRecoveryFileName)),
        releaseInfo: undefined, resourcesPath: root, userDataRoot: root,
        reservationOwner: { bindCandidate() { throw new Error('UNEXPECTED_PROCESS'); } },
        updateJournalStore: new UpdateJournalStore(join(root, updateJournalFileName)),
        operationIdFactory,
      });
    },
    async ports() {
      guard.registry = await registry.inspectSlots(); guard.journal = await journal.inspectSlots();
      return createWorkspaceFirstStartSelectedPersistence({ registry, journal }, guard);
    },
    async seedJournal(value: WorkspaceFirstStartMigrationJournalV1, slot: 'current' | 'next' = 'current') {
      await mkdir(paths.directoryPath, { recursive: true });
      await writeFile(paths[`${slot}Path`], serializeWorkspaceFirstStartMigrationJournal(value), { flag: 'wx' });
    },
  };
}
