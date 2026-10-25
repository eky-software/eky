import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import { AcceptedBuildMetadataStore, acceptedBuildMetadataFileName } from '../../update/acceptedBuildMetadataStore.js';
import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { readDeferredBusinessAcceptance } from './workspaceFirstStartDeferredBusiness.js';
import { WorkspaceFirstStartMigrationJournalStore } from './workspaceFirstStartMigrationJournalStore.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from './workspaceFirstStartMigrationJournalPaths.js';
import { WorkspaceFirstStartMigrationOrchestrator } from './workspaceFirstStartMigrationOrchestrator.js';
import { WorkspaceFirstStartMigrationTransitionCoordinator } from './workspaceFirstStartMigrationTransitionCoordinator.js';
import type { WorkspaceMigrationInventory } from './workspaceMigrationInventoryTypes.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES } from './workspaceFirstStartMigrationJournalCodec.js';

const at = '2026-10-25T12:00:00.000Z';
const source = { formatVersion: 1 as const, releaseChannel: 'pilot' as const,
  appVersion: '0.2.0', buildRevision: 'a'.repeat(40), acceptedAt: at };
const target = { ...source, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) };
const selector = createSelectorAcceptedBuildMetadata(source, target);
const sourceBuild = { appVersion: source.appVersion, buildRevision: source.buildRevision };
const targetBuild = { appVersion: target.appVersion, buildRevision: target.buildRevision };
const activeId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const passiveId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const operationId = '33333333-3333-4333-8333-333333333333';
const context = { activeWorkspaceId: activeId, workspaceState: 'publishedRegistry' as const };

it.for([1, 2] as const)('continues a pending-to-current restart using registry v%i and the original journal', async (version, test) => {
  const f = await fixture(test, version);
  const first = f.subject();
  await first.recoverBeforeWorkspaceResolution();
  expect(await first.prepareBeforeBackend(context)).toBe('prepared');
  const prepared = await f.journal.read();
  const before = await readFile(f.registryPath);
  f.state.pending = false;
  const restarted = f.subject();
  expect(await restarted.recoverBeforeWorkspaceResolution()).toBe('resumable');
  expect(await restarted.prepareBeforeBackend(context)).toBe('resumed');
  expect(await f.journal.read()).toEqual(prepared);
  expect(await readFile(f.registryPath)).toEqual(before);
  await restarted.transitionRegistryAfterActiveWorkspaceAcceptance();
  await expect(restarted.completeAfterTargetAcceptance()).rejects.toThrow();
  expect((await f.journal.read())?.state).toBe('registryTransitioned');
  expect(await f.accepted.read()).toEqual(selector);
  await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
  await restarted.completeAfterTargetAcceptance();
  expect(await f.journal.read()).toBeUndefined();
  expect((await f.registry.read())?.formatVersion).toBe(version);
  expect(f.recordFailure).not.toHaveBeenCalled();
});

it('inventories an all-current deferred opening without creating a journal', async test => {
  const f = await fixture(test);
  f.state.pending = false;
  const subject = f.subject();
  expect(await subject.recoverBeforeWorkspaceResolution()).toBe('noJournal');
  expect(await subject.prepareBeforeBackend(context)).toBe('notRequired');
  expect(f.inspect).toHaveBeenCalledOnce();
  expect(await f.journal.read()).toBeUndefined();
  await subject.transitionRegistryAfterActiveWorkspaceAcceptance();
  await expect(subject.completeAfterTargetAcceptance()).rejects.toThrow();
  await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
  await subject.completeAfterTargetAcceptance();
});

it.for(['prepared', 'registryTransitioned'] as const)(
  'recovers only the passive registry transition after %s interruption before business acceptance', async (stage, test) => {
    const f = await fixture(test);
    f.state.passiveInvalid = true;
    const before = await readFile(f.registryPath);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    const prepared = await f.journal.read();
    await subject.transitionRegistryAfterActiveWorkspaceAcceptance();
    // Model a crash before the transitioned journal was published, not a
    // forbidden backwards write through the production journal owner.
    if (stage === 'prepared') await writeFile(f.journalPath, JSON.stringify(prepared));
    expect(await f.subject().recoverBeforeWorkspaceResolution()).toBe('recoveredSource');
    expect(await readFile(f.registryPath)).toEqual(before);
    expect(await f.accepted.read()).toEqual(selector);
    expect(await f.journal.read()).toBeUndefined();
  },
);

it('finishes interrupted journal cleanup only after persisted business acceptance', async test => {
  const f = await fixture(test);
  f.state.passiveInvalid = true;
  const subject = f.subject();
  await subject.recoverBeforeWorkspaceResolution();
  await subject.prepareBeforeBackend(context);
  await subject.transitionRegistryAfterActiveWorkspaceAcceptance();
  const transitioned = await readFile(f.registryPath);
  await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
  expect(await f.subject().recoverBeforeWorkspaceResolution()).toBe('acceptedTarget');
  expect(await readFile(f.registryPath)).toEqual(transitioned);
  expect(await f.journal.read()).toBeUndefined();
});

it.for(['metadata', 'authority', 'registry', 'journal'] as const)(
  'rejects %s changed during inventory without creating C/Setup recovery', async (fault, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    const original = f.inspect.getMockImplementation()!;
    f.inspect.mockImplementationOnce(async () => {
      const value = await original();
      if (fault === 'metadata') await f.accepted.write(createSelectorAcceptedBuildMetadata(selector, { ...target, appVersion: '0.4.0' }));
      if (fault === 'authority') f.state.current = false;
      if (fault === 'registry') await f.registry.write({ ...(await f.registry.read())!, activeWorkspaceId: passiveId });
      if (fault === 'journal') {
        await f.transitions.prepare({ operationId, sourceBuild, targetBuild, createdAt: at,
          plan: { kind: 'required', activeWorkspace: { workspaceId: activeId, status: 'compatiblePending',
            appliedMigrationCount: 38, pendingMigrationCount: 1 }, passiveRecoveryWorkspaceIds: [] } });
      }
      return value;
    });
    await expect(subject.prepareBeforeBackend(context)).rejects.toThrow();
    expect(f.recordFailure).not.toHaveBeenCalled();
    expect((await f.journal.read())?.operationId).toBe(fault === 'journal' ? operationId : undefined);
  },
);

it.for(['baseline', 'application', 'timestamp', 'missing', 'legacy', 'running'] as const)(
  'does not use changed %s acceptance for deferred recovery', async (fault, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    const prepared = await f.journal.read();
    const before = await readFile(f.registryPath);
    if (fault === 'baseline') await f.accepted.write({ ...selector, businessBaseline: { ...source, buildRevision: 'c'.repeat(40) } });
    if (fault === 'application') await f.accepted.write(createSelectorAcceptedBuildMetadata(selector, { ...target, appVersion: '0.4.0' }));
    if (fault === 'timestamp') await f.accepted.write({ ...selector, acceptedBuild: { ...target, acceptedAt: '2026-10-25T13:00:00.000Z' } });
    if (fault === 'missing') await f.accepted.clear();
    if (fault === 'legacy') await writeFile(f.metadataPath, JSON.stringify(source));
    await expect(f.subject('exactAcceptedBuild', fault === 'running' ? sourceBuild : targetBuild)
      .recoverBeforeWorkspaceResolution()).rejects.toThrow();
    expect(await f.journal.read()).toEqual(prepared);
    expect(await readFile(f.registryPath)).toEqual(before);
  },
);

it.for(['selection', 'passiveSet', 'sourceHash', 'targetHash'] as const)(
  'rejects resumed %s disagreement and preserves existing bytes', async (fault, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    const restarted = f.subject();
    await restarted.recoverBeforeWorkspaceResolution();
    if (fault === 'selection') await f.registry.write({ ...(await f.registry.read())!, activeWorkspaceId: passiveId });
    if (fault === 'passiveSet') f.state.passiveInvalid = true;
    if (fault === 'sourceHash' || fault === 'targetHash') {
      const journal = (await f.journal.read())!;
      await writeFile(f.journalPath, JSON.stringify({ ...journal,
        [fault === 'sourceHash' ? 'sourceRegistrySha256' : 'transitionedRegistrySha256']: 'd'.repeat(64) }));
    }
    const before = await readFile(f.registryPath);
    const journal = await f.journal.read();
    await expect(restarted.prepareBeforeBackend(context)).rejects.toThrow();
    expect(await readFile(f.registryPath)).toEqual(before);
    expect(await f.journal.read()).toEqual(journal);
    expect(f.recordFailure).not.toHaveBeenCalled();
  },
);

it.for(['transition', 'cancel', 'complete'] as const)('retains state when authority expires before %s', async (phase, test) => {
  const f = await fixture(test);
  const subject = f.subject();
  await subject.recoverBeforeWorkspaceResolution();
  await subject.prepareBeforeBackend(context);
  if (phase === 'complete') {
    await subject.transitionRegistryAfterActiveWorkspaceAcceptance();
    await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
  }
  const journal = await f.journal.read();
  const before = await readFile(f.registryPath);
  f.state.current = false;
  await expect(phase === 'transition' ? subject.transitionRegistryAfterActiveWorkspaceAcceptance()
    : phase === 'cancel' ? f.transitions.cancelPrepared(operationId) : subject.completeAfterTargetAcceptance()).rejects.toThrow();
  expect(await f.journal.read()).toEqual(journal);
  expect(await readFile(f.registryPath)).toEqual(before);
});

it('rejects a non-deferred admission and never downgrades application acceptance', async test => {
  const f = await fixture(test);
  await expect(f.subject('authorizedNewerBuild').recoverBeforeWorkspaceResolution()).rejects.toThrow();
  expect(await f.accepted.read()).toEqual(selector);
  expect(f.inspect).not.toHaveBeenCalled();
});

it('rejects lost authority after the acceptance read', async test => {
  const f = await fixture(test);
  const reader = { read: async () => { f.state.current = false; return selector; } };
  await expect(readDeferredBusinessAcceptance(f.authority, reader, targetBuild)).rejects.toThrow('SYNTHETIC_AUTHORITY_EXPIRED');
});

it.for(['prepare', 'transition', 'cancel', 'complete', 'recover'] as const)(
  'preserves every recovery slot before %s when authority already expired', async (phase, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    const slots: Array<{ path: string; bytes: Buffer }> = [];
    for (const path of [f.registryPath, f.journalPath, f.metadataPath]) {
      const bytes = await readFile(path);
      for (const suffix of ['', '.next', '.backup']) {
        if (suffix !== '') await writeFile(`${path}${suffix}`, bytes);
        slots.push({ path: `${path}${suffix}`, bytes });
      }
    }
    f.state.current = false;
    const action = phase === 'prepare' ? f.transitions.prepare({ operationId, sourceBuild, targetBuild, createdAt: at,
      plan: { kind: 'required', activeWorkspace: { workspaceId: activeId, status: 'compatiblePending',
        appliedMigrationCount: 38, pendingMigrationCount: 1 }, passiveRecoveryWorkspaceIds: [] } })
      : phase === 'transition' ? f.transitions.transitionRegistry({ operationId, sourceBuild, targetBuild, updatedAt: at })
      : phase === 'cancel' ? f.transitions.cancelPrepared(operationId)
      : phase === 'complete' ? f.transitions.completeAcceptedTarget({ operationId, sourceBuild, targetBuild })
      : f.transitions.recover(targetBuild);
    await expect(action).rejects.toThrow('SYNTHETIC_AUTHORITY_EXPIRED');
    for (const slot of slots) expect(await readFile(slot.path)).toEqual(slot.bytes);
  },
);

it.for(['cancel', 'recover'] as const)(
  'does not repair registry slots after authority expires during the %s journal read', async (phase, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    const before = await readFile(f.registryPath);
    await writeFile(`${f.registryPath}.next`, before);
    const read = f.journal.read.bind(f.journal);
    vi.spyOn(f.journal, 'read').mockImplementationOnce(async () => {
      const value = await read();
      f.state.current = false;
      return value;
    });
    await expect(phase === 'cancel' ? f.transitions.cancelPrepared(operationId)
      : f.transitions.recover(targetBuild)).rejects.toThrow('SYNTHETIC_AUTHORITY_EXPIRED');
    expect(await readFile(f.registryPath)).toEqual(before);
    expect(await readFile(`${f.registryPath}.next`)).toEqual(before);
  },
);

it.for(['prepared', 'resumed', 'notRequired', 'inventoryFailed'] as const)(
  'cancels only the deferred preparation after terminal proof (%s)', async (stage, test) => {
    const f = await fixture(test);
    let subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    if (stage === 'notRequired') f.state.pending = false;
    if (stage === 'inventoryFailed') f.inspect.mockRejectedValueOnce(new Error('SYNTHETIC_INVENTORY_FAILED'));
    if (stage === 'inventoryFailed') await expect(subject.prepareBeforeBackend(context)).rejects.toThrow();
    else await subject.prepareBeforeBackend(context);
    if (stage === 'resumed') {
      subject = f.subject();
      await subject.recoverBeforeWorkspaceResolution();
      // A failure before repeated inventory must still cancel the exact resumed preparation.
    }
    const registry = await readFile(f.registryPath);
    const assertTerminal = vi.fn(async () => undefined);
    await subject.cancelBeforeSelectorReturn({ assertCurrent() {}, assertTerminal });
    expect(assertTerminal).toHaveBeenCalled();
    expect(await f.journal.inspect()).toBeUndefined();
    expect((await readFile(f.registryPath)).equals(registry)).toBe(true);
    expect(await f.accepted.read()).toEqual(selector);
    await expect(subject.transitionRegistryAfterActiveWorkspaceAcceptance()).rejects.toThrow();
    await expect(subject.completeAfterTargetAcceptance()).rejects.toThrow();
    await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {}, assertTerminal })).rejects.toThrow();
    expect(f.recordFailure).not.toHaveBeenCalled();
  },
);

it.for(['terminal', 'authority', 'metadata', 'registry', 'journal', 'next', 'backup'] as const)(
  'preserves deferred state on rejected selector return (%s)', async (fault, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    if (fault === 'authority') f.state.current = false;
    if (fault === 'metadata') await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
    if (fault === 'registry') await f.registry.write({ ...(await f.registry.read())!, activeWorkspaceId: passiveId });
    if (fault === 'journal') await writeFile(f.journalPath, JSON.stringify({ ...(await f.journal.read())!, updatedAt: '2026-10-25T13:00:00.000Z' }));
    if (fault === 'next' || fault === 'backup') await writeFile(`${f.journalPath}.${fault}`, await readFile(f.journalPath));
    const journal = await readFile(f.journalPath);
    const registry = await readFile(f.registryPath);
    await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {}, async assertTerminal() {
      if (fault === 'terminal') throw new Error('SYNTHETIC_RUNTIME_UNRESOLVED');
    } })).rejects.toThrow();
    expect((await readFile(f.journalPath)).equals(journal)).toBe(true);
    expect((await readFile(f.registryPath)).equals(registry)).toBe(true);
    if (fault === 'next' || fault === 'backup') expect((await readFile(`${f.journalPath}.${fault}`)).equals(journal)).toBe(true);
  },
);

it('retains an unacknowledged preparation instead of adopting it for cancellation', async test => {
  const f = await fixture(test);
  const prepare = f.transitions.prepare.bind(f.transitions);
  vi.spyOn(f.transitions, 'prepare').mockImplementationOnce(async input => {
    await prepare(input);
    throw new Error('SYNTHETIC_PREPARE_ACK_LOST');
  });
  const subject = f.subject();
  await subject.recoverBeforeWorkspaceResolution();
  await expect(subject.prepareBeforeBackend(context)).rejects.toThrow();
  const before = await readFile(f.journalPath);
  await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {}, async assertTerminal() {} })).rejects.toThrow();
  expect((await readFile(f.journalPath)).equals(before)).toBe(true);
});

it.for(['transition', 'complete'] as const)('never cancels after %s starts', async (stage, test) => {
  const f = await fixture(test);
  const subject = f.subject();
  await subject.recoverBeforeWorkspaceResolution();
  await subject.prepareBeforeBackend(context);
  await subject.transitionRegistryAfterActiveWorkspaceAcceptance();
  if (stage === 'complete') {
    await f.accepted.write(createBusinessAcceptedBuildMetadata(selector, target));
    await subject.completeAfterTargetAcceptance();
  }
  const journal = await f.journal.inspect();
  const terminal = vi.fn(async () => undefined);
  await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {}, assertTerminal: terminal })).rejects.toThrow();
  expect(terminal).not.toHaveBeenCalled();
  expect(await f.journal.inspect()).toEqual(journal);
});

it('does not race cancellation against an unfinished inventory', async test => {
  const f = await fixture(test);
  const inspect = f.inspect.getMockImplementation()!;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.inspect.mockImplementationOnce(async () => {
    entered();
    await new Promise<void>(resolve => { release = resolve; });
    return inspect();
  });
  const subject = f.subject();
  await subject.recoverBeforeWorkspaceResolution();
  const preparing = subject.prepareBeforeBackend(context);
  await started;
  try {
    await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {}, async assertTerminal() {} })).rejects.toThrow();
  } finally { release(); }
  expect(await preparing).toBe('prepared');
  expect((await f.journal.inspect())?.value.state).toBe('prepared');
});

it('retains the journal when terminal authority expires at the actual unlink', async test => {
  let cancellation = false;
  let current = true;
  const f = await fixture(test, 2, base => {
    const remove = base.removeSlot.bind(base);
    vi.spyOn(base, 'removeSlot').mockImplementation(async (slot, guard) => {
      if (cancellation && slot === 'current') current = false;
      return remove(slot, guard);
    });
    return base;
  });
  const subject = f.subject();
  await subject.recoverBeforeWorkspaceResolution();
  await subject.prepareBeforeBackend(context);
  const journal = await readFile(f.journalPath);
  cancellation = true;
  await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {
    if (!current) throw new Error('SYNTHETIC_TERMINAL_EXPIRED');
  }, async assertTerminal() {} })).rejects.toMatchObject({ failure: 'unavailable' });
  expect(current).toBe(false);
  expect((await readFile(f.journalPath)).equals(journal)).toBe(true);
});

it('seals a cancellation with a lost acknowledgement and lets fresh startup inspect the durable result', async test => {
  const f = await fixture(test);
  const subject = f.subject();
  await subject.recoverBeforeWorkspaceResolution();
  await subject.prepareBeforeBackend(context);
  const discard = f.journal.discardPrepared.bind(f.journal);
  vi.spyOn(f.journal, 'discardPrepared').mockImplementationOnce(async (...args) => {
    await discard(...args);
    throw new Error('SYNTHETIC_CANCEL_ACK_LOST');
  });
  await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {}, async assertTerminal() {} })).rejects.toThrow('SYNTHETIC_CANCEL_ACK_LOST');
  await expect(subject.transitionRegistryAfterActiveWorkspaceAcceptance()).rejects.toThrow();
  expect(await f.subject().recoverBeforeWorkspaceResolution()).toBe('noJournal');
  expect(await f.accepted.read()).toEqual(selector);
});

it.for(['sameBytes', 'equivalentJson'] as const)(
  'preserves a replacement made between cancellation inspection and discard (%s)', async (fault, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    const original = await readFile(f.journalPath);
    const replacement = fault === 'sameBytes' ? original : Buffer.from(JSON.stringify(JSON.parse(original.toString()), null, 2));
    const discard = f.journal.discardPrepared.bind(f.journal);
    vi.spyOn(f.journal, 'discardPrepared').mockImplementationOnce(async (...args) => {
      await rename(f.journalPath, `${f.journalPath}.retained-test-original`);
      await writeFile(f.journalPath, replacement);
      return discard(...args);
    });
    await expect(subject.cancelBeforeSelectorReturn({ assertCurrent() {}, async assertTerminal() {} })).rejects.toThrow();
    expect((await readFile(f.journalPath)).equals(replacement)).toBe(true);
    expect((await readFile(`${f.journalPath}.retained-test-original`)).equals(original)).toBe(true);
  },
);

it.for((['orchestrator', 'store'] as const).flatMap(layer =>
  (['current', 'terminal'] as const).map(kind => ({ layer, kind }))))(
  'preserves the journal when the $layer $kind callback is replaced', async ({ layer, kind }, test) => {
    const f = await fixture(test);
    const subject = f.subject();
    await subject.recoverBeforeWorkspaceResolution();
    await subject.prepareBeforeBackend(context);
    const selected = (await f.journal.inspect())!;
    const registry = await readFile(f.registryPath);
    let current = true;
    const asyncKey = layer === 'store' ? 'assertExternalSelection' : 'assertTerminal';
    const guard = {
      selected,
      assertCurrent() { if (kind === 'current' && !current) throw new Error('SYNTHETIC_AUTHORITY_LOST'); },
      async assertTerminal() { await check(); },
      async assertExternalSelection() { await check(); },
    };
    async function check() {
      if (kind === 'terminal' && !current) throw new Error('SYNTHETIC_TERMINAL_LOST');
      await Promise.resolve();
      current = false;
      if (kind === 'current') guard.assertCurrent = () => {};
      else guard[asyncKey] = async () => {};
    }
    await expect(layer === 'store' ? f.journal.discardPrepared(operationId, guard)
      : subject.cancelBeforeSelectorReturn(guard)).rejects.toThrow();
    expect(current).toBe(false);
    expect(await readFile(f.journalPath)).toEqual(Buffer.from(selected.bytes));
    expect(await readFile(f.registryPath)).toEqual(registry);
    expect(await f.accepted.read()).toEqual(selector);
  },
);

async function fixture(test: TestContext, version: 1 | 2 = 2,
  wrapFileSystem?: (base: CrashSafeFileSlotFileSystem) => CrashSafeFileSlotFileSystem) {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6-deferred-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const initial: LocalWorkspaceRegistry = { formatVersion: version, activeWorkspaceId: activeId,
    workspaces: [activeId, passiveId].map((workspaceId, index) => ({ workspaceId,
      workspaceLabel: index === 0 ? 'Synthetic active' : 'Synthetic passive',
      lineageIdentity: { formatVersion: 1 as const, profileId: (index === 0 ? 'a' : 'b').repeat(64) },
      layoutVersion: 1 as const, lifecycleState: 'ready' as const, createdAt: at })) };
  await registry.write(initial);
  const accepted = new AcceptedBuildMetadataStore(join(root, acceptedBuildMetadataFileName));
  await accepted.write(selector);
  const state = { current: true, pending: true, passiveInvalid: false };
  const assertCurrent = vi.fn(async () => { if (!state.current) throw new Error('SYNTHETIC_AUTHORITY_EXPIRED'); });
  const authority = { acceptedBuild: selector, assertCurrent };
  const journal = new WorkspaceFirstStartMigrationJournalStore({ userDataPath: root,
    ...(wrapFileSystem === undefined ? {} : { fileSystem: wrapFileSystem(createNodeCrashSafeFileSlotFileSystem(
      createWorkspaceFirstStartMigrationJournalPaths(root), WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES)) }) });
  const transitions = new WorkspaceFirstStartMigrationTransitionCoordinator({ acceptedBuild: accepted, journal, registry, deferredBusiness: authority });
  const inspect = vi.fn(async (): Promise<WorkspaceMigrationInventory> => ({ activeWorkspaceId: activeId,
    entries: [{ workspaceId: activeId, isActive: true, appliedMigrationCount: state.pending ? 38 : 39,
      pendingMigrationCount: state.pending ? 1 : 0, status: state.pending ? 'compatiblePending' : 'current' },
    { workspaceId: passiveId, isActive: false, appliedMigrationCount: state.passiveInvalid ? 0 : 39,
      pendingMigrationCount: 0, status: state.passiveInvalid ? 'invalidHistory' : 'current' }] }));
  const recordFailure = vi.fn(async (): Promise<never> => { throw new Error('UNEXPECTED_SETUP_RECOVERY'); });
  const subject = (admission: PreWorkspaceBuildAdmission = 'exactAcceptedBuild', runningBuild = targetBuild) =>
    new WorkspaceFirstStartMigrationOrchestrator({ admission, deferredBusiness: authority, acceptedBuild: accepted,
      registry, journal, transitions, runningBuild, inventory: { inspect }, failureAuthority: { recordFailure },
      now: () => new Date(at), operationIdFactory: () => operationId });
  return { registry, registryPath, accepted, metadataPath: join(root, acceptedBuildMetadataFileName),
    journalPath: createWorkspaceFirstStartMigrationJournalPaths(root).currentPath,
    state, authority, journal, transitions, inspect, recordFailure, subject };
}
