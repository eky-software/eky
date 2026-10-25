import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import { resolveDesktopWorkspaceStartup } from '../../main/resolveDesktopWorkspaceStartup.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { resolveActiveWorkspaceStartup } from '../runtime/resolveActiveWorkspaceStartup.js';
import { WorkspaceActivationMigrationGuard } from '../update/workspaceActivationMigrationGuard.js';
import {
  createWorkspaceSwitchJournalPaths, serializeVersionedWorkspaceSwitchJournal,
  WorkspaceSwitchJournalStore, type WorkspaceSwitchJournalV2,
} from './workspaceSwitchJournal.js';
import {
  createWorkspaceSelectorSwitchJournal, createWorkspaceSelectorSwitchRegistryVariants,
} from './workspaceSelectorSwitchState.js';
import { resolveWorkspaceSelectorSwitchStartup, type WorkspaceSelectorSwitchStartupAuthority } from './workspaceSelectorSwitchStartup.js';
import {
  createSwitchJournal, createSwitchRegistry, TEST_SWITCH_CREATED_AT, TEST_SWITCH_OPERATION_ID,
  TEST_TARGET_WORKSPACE_ID,
} from './workspaceSwitchTestSupport.js';

const variants = createWorkspaceSelectorSwitchRegistryVariants({
  ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId: null,
}, TEST_TARGET_WORKSPACE_ID);
const prepared = createWorkspaceSelectorSwitchJournal(
  variants.before, TEST_TARGET_WORKSPACE_ID, TEST_SWITCH_OPERATION_ID, TEST_SWITCH_CREATED_AT,
);
const selected = { ...prepared, state: 'targetSelected' as const };
const profileId = 'b'.repeat(64);

it('resolves actual persisted source-null startup and mints the activation guard selection', async test => {
  const f = await fixture(test);
  const startup = await f.resolve();
  expect(startup).toMatchObject({ mode: 'targetValidation', workspaceId: TEST_TARGET_WORKSPACE_ID,
    switchContext: { operationId: TEST_SWITCH_OPERATION_ID, sourceWorkspaceId: null, targetProfileId: profileId } });
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  const legacyRead = vi.fn();
  const guard = new WorkspaceActivationMigrationGuard({ read: legacyRead }, { read: legacyRead }, startup.selectorActivationAuthority);
  const proof = await guard.prove({ operationId: TEST_SWITCH_OPERATION_ID, sourceWorkspaceId: null,
    targetWorkspaceId: TEST_TARGET_WORKSPACE_ID, expectedProfileId: profileId });
  await guard.reprove(proof);
  expect(legacyRead).not.toHaveBeenCalled();
  expect(f.proveTerminal).not.toHaveBeenCalled();
  const before = await f.snapshot();
  f.current = false;
  await expect(guard.reprove(proof)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['current', 'current-next', 'backup-next', 'current-backup', 'backup'] as const)(
  'resolves interrupted journal publication %s with exact registry preservation', async (shape, test) => {
    const f = await fixture(test);
    await f.setJournal(shape === 'current' ? { current: prepared }
      : shape === 'current-next' ? { current: prepared, next: selected }
      : shape === 'backup-next' ? { backup: prepared, next: selected }
      : shape === 'current-backup' ? { current: selected, backup: prepared } : { backup: selected });
    const beforeRegistry = await readFile(f.registryPath);
    const result = await f.resolve();
    expect(result.mode).toBe('targetValidation');
    expect((await f.journal.inspectSlots()).current?.value).toEqual(selected);
    expect(await readFile(f.registryPath)).toEqual(beforeRegistry);
    expect((await f.journal.inspectSlots()).next).toBeUndefined();
    expect((await f.journal.inspectSlots()).backup).toBeUndefined();
  },
);

it.for(['current-next', 'backup-next', 'current-backup', 'backup'] as const)(
  'recovers the interrupted registry %s before choosing selector or target', async (shape, test) => {
    const f = await fixture(test);
    await f.setJournal({ current: prepared });
    await rm(f.registryPath);
    const values = shape === 'current-next' ? { current: variants.before, next: variants.selected }
      : shape === 'backup-next' ? { backup: variants.before, next: variants.selected }
      : shape === 'current-backup' ? { current: variants.selected, backup: variants.before }
      : { backup: variants.selected };
    for (const [slot, value] of Object.entries(values)) {
      await writeFile(slot === 'current' ? f.registryPath : f.registryPath + '.' + slot, serializeWorkspaceRegistry(value), { mode: 0o600 });
    }
    const startup = await f.resolve();
    const expectSelector = shape === 'current-next' || shape === 'backup-next';
    expect(startup.mode).toBe(expectSelector ? 'selector' : 'targetValidation');
    expect(await f.registry.inspect()).toEqual(expectSelector ? variants.before : variants.selected);
    expect((await f.registry.inspectSlots()).next).toBeUndefined();
    expect((await f.registry.inspectSlots()).backup).toBeUndefined();
  },
);

it.for(['unpublished', 'uncommitted', 'returning', 'returned'] as const)(
  'returns %s preparation to selector only with a current absence/terminal proof', async (phase, test) => {
    const f = await fixture(test);
    await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
    await f.setJournal(phase === 'unpublished' ? { next: prepared }
      : { current: phase === 'uncommitted' ? prepared : phase === 'returning' ? selected : { ...selected, state: 'rollbackSelected' } });
    const startup = await f.resolve();
    expect(startup.mode).toBe('selector');
    expect(f.proveTerminal).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'selectorReturn' }));
    expect(await f.journal.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
    expect(await f.registry.inspect()).toEqual(variants.before);
  },
);

it.for(['ready', 'empty', 'recoveryOnly'] as const)(
  'does not create a business session or default company for %s selector', async (kind, test) => {
    const f = await fixture(test);
    const registry = { ...variants.before, workspaces: kind === 'empty' ? [] : variants.before.workspaces.map(entry =>
      kind === 'recoveryOnly' ? { ...entry, lifecycleState: 'recoveryRequired' as const } : entry) };
    await writeFile(f.registryPath, serializeWorkspaceRegistry(registry));
    await f.setJournal({});
    const createRuntimeSession = vi.fn();
    const before = await f.snapshot();
    const startup = await resolveDesktopWorkspaceStartup({
      assertStartupCurrent: f.assertCurrent,
      createRuntimeSession, relaunchApplication: vi.fn(), resolveActiveWorkspace: f.resolve, userDataRoot: f.root,
    });
    expect(startup).toMatchObject({ status: 'selector', selection: { registry } });
    expect(createRuntimeSession).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  },
);

it('clears only the selected journal after the current business terminal and lineage check', async test => {
  const f = await fixture(test);
  const startup = await f.resolve();
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  expect(() => startup.assertCanAccept('a'.repeat(64))).toThrow('WORKSPACE_SWITCH_INVALID');
  expect(f.proveTerminal).not.toHaveBeenCalled();
  await startup.accept(profileId);
  expect(f.proveTerminal).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'acceptedTarget', journal: selected }));
  expect(await f.registry.inspect()).toEqual(variants.selected);
  expect((await f.journal.inspectSlots()).current).toBeUndefined();
  await expect(startup.recoverFromFailure()).rejects.toThrow();
});

it.for([false, true])('returns safely after failure without changing neighbours (invalid target: %s)', async (invalidTarget, test) => {
  const f = await fixture(test);
  const startup = await f.resolve();
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  await expect(invalidTarget ? startup.rejectInvalidTarget!() : startup.recoverFromFailure()).resolves.toBe('relaunchRequired');
  expect(await f.registry.inspect()).toEqual(invalidTarget ? variants.rejected : variants.before);
  expect((await f.journal.inspectSlots()).current?.value).toEqual({ ...selected, state: 'rollbackSelected' });
  const nextStartup = await f.resolve();
  expect(nextStartup.mode).toBe('selector');
  expect((await f.journal.inspectSlots()).current).toBeUndefined();
});

it('retains selected evidence and refuses opening after explicit recovery-required marking', async test => {
  const f = await fixture(test);
  const startup = await f.resolve();
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  await expect(startup.requireRecovery!()).resolves.toBe('recoveryRequired');
  const before = await f.snapshot();
  await expect(f.resolve()).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  expect(await f.snapshot()).toEqual(before);
});

it.for(['accept', 'return', 'reject'] as const)('does not mutate anything without %s terminal proof', async (action, test) => {
  const f = await fixture(test);
  const startup = await f.resolve();
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  f.proveTerminal.mockRejectedValueOnce(new Error('terminal unavailable'));
  const before = await f.snapshot();
  await expect(action === 'accept' ? startup.accept(profileId)
    : action === 'reject' ? startup.rejectInvalidTarget!() : startup.recoverFromFailure()).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['startup', 'terminal', 'registry', 'journal'] as const)(
  'rejects %s authority/selection changed during terminal proof', async (change, test) => {
    const f = await fixture(test);
    const startup = await f.resolve();
    if (startup.mode === 'selector') throw new Error('unexpected selector');
    let retained: Awaited<ReturnType<typeof f.snapshot>>;
    f.proveTerminal.mockImplementationOnce(async () => {
      if (change === 'startup') f.current = false;
      if (change === 'terminal') f.terminalCurrent = false;
      if (change === 'registry') await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
      if (change === 'journal') await writeFile(f.journalPaths.nextPath, serializeVersionedWorkspaceSwitchJournal({ ...selected, state: 'recoveryRequired' }));
      retained = await f.snapshot();
      return { assertCurrent: f.assertTerminal };
    });
    await expect(startup.accept(profileId)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(retained!);
  },
);

it.for(['registry', 'journal'] as const)('does not accept a same-byte replacement %s file', async (kind, test) => {
  const f = await fixture(test);
  const startup = await f.resolve();
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  const path = kind === 'registry' ? f.registryPath : f.journalPaths.currentPath;
  const bytes = await readFile(path);
  await rename(path, path + '.retained');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  const before = await f.snapshot();
  await expect(startup.accept(profileId)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect((await readFile(path + '.retained')).equals(bytes)).toBe(true);
});

it('does not allow an exposed activation snapshot to alter the startup selection', async test => {
  const f = await fixture(test);
  const startup = await f.resolve();
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  startup.selectorActivationAuthority!.selection.registrySlots.current!.bytes.fill(0);
  await expect(startup.accept(profileId)).resolves.toBeUndefined();
});

it.for(['journalRecovery', 'registryRecovery', 'journalWrite', 'registryWrite'] as const)(
  'rejects same-byte replacement between %s and its readback', async (operation, test) => {
    const f = await fixture(test);
    const path = operation.startsWith('journal') ? f.journalPaths.currentPath : f.registryPath;
    let retained: Awaited<ReturnType<typeof f.snapshot>>;
    let original: Buffer;
    const replacePublished = async () => {
      original = await readFile(path);
      await rename(path, path + '.retained');
      await writeFile(path, original, { flag: 'wx', mode: 0o600 });
      retained = await f.snapshot();
    };
    if (operation === 'journalRecovery') {
      await f.setJournal({ current: selected, backup: prepared });
      const recover = f.journal.recoverSelector.bind(f.journal);
      vi.spyOn(f.journal, 'recoverSelector').mockImplementationOnce(async (...args) => {
        const result = await recover(...args); await replacePublished(); return result;
      });
    } else if (operation === 'registryRecovery') {
      await f.setJournal({ current: prepared });
      await writeFile(f.registryPath + '.backup', serializeWorkspaceRegistry(variants.before));
      const recover = f.registry.recoverSelected.bind(f.registry);
      vi.spyOn(f.registry, 'recoverSelected').mockImplementationOnce(async (...args) => {
        const result = await recover(...args); await replacePublished(); return result;
      });
    } else if (operation === 'journalWrite') {
      await f.setJournal({ current: prepared });
      const write = f.journal.writeSelector.bind(f.journal);
      vi.spyOn(f.journal, 'writeSelector').mockImplementationOnce(async (...args) => {
        const result = await write(...args); await replacePublished(); return result;
      });
    } else {
      const write = f.registry.writeSelected.bind(f.registry);
      vi.spyOn(f.registry, 'writeSelected').mockImplementationOnce(async (...args) => {
        const result = await write(...args); await replacePublished(); return result;
      });
    }
    const run = async () => {
      const startup = await f.resolveSwitch();
      if (operation === 'registryWrite' && startup.mode !== 'selector') await startup.recoverFromFailure();
    };
    await expect(run()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(retained!);
    expect(await readFile(path + '.retained')).toEqual(original!);
  },
);

it.for([
  { slot: 'current', remainder: '{"formatVersion":1,"state":' },
  { slot: 'backup', remainder: '{"formatVersion":1,"state":' },
  { slot: 'current', remainder: '' },
  { slot: 'backup', remainder: '' },
] as const)('preserves v1 recovery with an interrupted next write %#', async ({ slot, remainder }, test) => {
  const f = await fixture(test);
  await writeFile(f.registryPath, serializeWorkspaceRegistry(createSwitchRegistry(TEST_TARGET_WORKSPACE_ID)));
  await f.setJournal({});
  await writeFile(f.journalPaths[`${slot}Path`], serializeVersionedWorkspaceSwitchJournal(createSwitchJournal('targetSelected')));
  await writeFile(f.journalPaths.nextPath, remainder);
  const result = await resolveActiveWorkspaceStartup(f.root);
  expect(result.mode).toBe('targetValidation');
  expect((await f.journal.inspectSlots()).next).toBeUndefined();
  expect((await f.journal.inspectSlots()).current?.value).toEqual(createSwitchJournal('targetSelected'));
});

it.for(['v1CurrentV2Next', 'v1BackupV2Next', 'v2CurrentV1Next', 'invalidCurrent', 'emptyCurrent', 'v2PartialNext', 'v2EmptyNext'] as const)(
  'preserves %s instead of delegating contradictory slots to legacy recovery', async (shape, test) => {
    const f = await fixture(test);
    const v1 = serializeVersionedWorkspaceSwitchJournal(createSwitchJournal('targetSelected'));
    if (shape === 'v1CurrentV2Next' || shape === 'v1BackupV2Next') {
      await f.setJournal({ next: prepared });
      await writeFile(shape === 'v1CurrentV2Next' ? f.journalPaths.currentPath : f.journalPaths.backupPath, v1);
    } else if (shape === 'v2CurrentV1Next') {
      await writeFile(f.journalPaths.nextPath, v1);
    } else if (shape === 'invalidCurrent' || shape === 'emptyCurrent') {
      await writeFile(f.journalPaths.currentPath, shape === 'emptyCurrent' ? '' : '{');
      await writeFile(f.journalPaths.backupPath, v1);
    } else await writeFile(f.journalPaths.nextPath, shape === 'v2EmptyNext' ? '' : '{"formatVersion":2,"state":');
    const before = await f.snapshot();
    await expect(f.resolve()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.proveTerminal).not.toHaveBeenCalled();
  },
);

it('preserves conflicting adoption slots instead of invoking their repairing reader', async test => {
  const f = await fixture(test);
  const paths = createWorkspaceLegacyAdoptionJournalPaths(f.root);
  await writeFile(paths.nextPath, 'synthetic-unselected-evidence');
  const before = await f.snapshot();
  await expect(f.resolve()).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  expect(await readFile(paths.nextPath, 'utf8')).toBe('synthetic-unselected-evidence');
  expect(await f.snapshot()).toEqual(before);
});

it('does not activate source-null startup without explicit main authority', async test => {
  const f = await fixture(test);
  const before = await f.snapshot();
  await expect(resolveActiveWorkspaceStartup(f.root)).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  expect(await f.snapshot()).toEqual(before);
});

it('rejects a new registry mutation observed between initial reads', async test => {
  const f = await fixture(test);
  const journalSlots = await f.journal.inspectSlots();
  const registrySlots = await f.registry.inspectSlots();
  await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
  const before = await f.snapshot();
  await expect(resolveWorkspaceSelectorSwitchStartup({
    registry: f.registry, journal: f.journal, authority: f.authority,
    selection: { journalSlots, registrySlots, readRegistrySlots: () => f.registry.inspectSlots(), assertAuthority: f.assertCurrent },
  })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('does not create a business session when a selector selection expires before consumption', async test => {
  const f = await fixture(test);
  await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
  await f.setJournal({});
  const createRuntimeSession = vi.fn();
  await expect(resolveDesktopWorkspaceStartup({
    assertStartupCurrent: f.assertCurrent,
    createRuntimeSession, relaunchApplication: vi.fn(), userDataRoot: f.root,
    async resolveActiveWorkspace() { const result = await f.resolve(); f.current = false; return result; },
  })).rejects.toThrow();
  expect(createRuntimeSession).not.toHaveBeenCalled();
});

it.for(['registry', 'journal'] as const)('recovers a lost %s return acknowledgement only from durable state', async (owner, test) => {
  const f = await fixture(test);
  const startup = await f.resolveSwitch();
  if (startup.mode === 'selector') throw new Error('unexpected selector');
  if (owner === 'registry') {
    const write = f.registry.writeSelected.bind(f.registry);
    vi.spyOn(f.registry, 'writeSelected').mockImplementationOnce(async (...args) => {
      await write(...args); throw new Error('lost registry acknowledgement');
    });
  } else {
    const write = f.journal.writeSelector.bind(f.journal);
    vi.spyOn(f.journal, 'writeSelector').mockImplementationOnce(async (...args) => {
      await write(...args); throw new Error('lost journal acknowledgement');
    });
  }
  await expect(startup.recoverFromFailure()).rejects.toThrow('lost');
  expect(await f.registry.inspect()).toEqual(variants.before);
  expect((await f.journal.inspectSlots()).current?.value.state).toBe(owner === 'registry' ? 'targetSelected' : 'rollbackSelected');
  await expect(startup.accept(profileId)).rejects.toThrow();
  const recovered = await f.resolve();
  expect(recovered.mode).toBe('selector');
  expect((await f.journal.inspectSlots()).current).toBeUndefined();
});

it.for(['beforeReturn', 'afterReturn'] as const)('rechecks terminal authority at %s consumption', async (phase, test) => {
  const f = await fixture(test);
  await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
  await f.setJournal({});
  const startup = await f.resolve();
  if (startup.mode !== 'selector') throw new Error('unexpected business');
  if (phase === 'beforeReturn') f.terminalCurrent = false;
  else {
    await startup.assertCurrent();
    f.terminalCurrent = false;
  }
  await expect(startup.assertCurrent()).rejects.toThrow('terminal expired');
});

it('requires a terminal proof before returning from an invalid selected root', async test => {
  const f = await fixture(test);
  await rm(deriveWorkspaceRoot(f.root, TEST_TARGET_WORKSPACE_ID, 1).workspaceRoot, { recursive: true });
  const terminalFailure = new Error('nested recovery unsettled');
  f.proveTerminal.mockRejectedValueOnce(terminalFailure);
  const before = await f.snapshot();
  const failure = await f.resolve().catch((error: Error) => error);
  expect(failure).toMatchObject({ message: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED' });
  if (!(failure instanceof Error) || !(failure.cause instanceof AggregateError)) throw new Error('missing original cause');
  expect(failure.cause.errors[0]).toMatchObject({ code: 'WORKSPACE_ROOT_INVALID' });
  expect(failure.cause.errors[1]).toBe(terminalFailure);
  expect(await f.snapshot()).toEqual(before);
  await expect(f.resolve()).rejects.toMatchObject({ code: 'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED' });
  expect(await f.registry.inspect()).toEqual(variants.rejected);
});

it('rejects asynchronous authority rather than treating an unobserved promise as permission', async test => {
  const f = await fixture(test);
  const before = await f.snapshot();
  const authority = { ...f.authority, assertCurrent: async () => undefined };
  await expect(resolveWorkspaceSelectorSwitchStartup({
    registry: f.registry, journal: f.journal, authority,
    selection: { journalSlots: await f.journal.inspectSlots(), registrySlots: await f.registry.inspectSlots(),
      readRegistrySlots: () => f.registry.inspectSlots(), assertAuthority: f.assertCurrent },
  })).rejects.toThrow('WORKSPACE_SWITCH_INVALID');
  expect(await f.snapshot()).toEqual(before);
});

it.for(['mixed', 'threeSlots', 'wrongOrder', 'initialNextSelected'] as const)(
  'preserves %s contradictory slots before any recovery or terminal request', async (kind, test) => {
    const f = await fixture(test);
    if (kind === 'mixed') await writeFile(f.journalPaths.nextPath, Buffer.from('{"formatVersion":1}'));
    if (kind === 'threeSlots') await f.setJournal({ current: selected, backup: prepared, next: { ...selected, state: 'recoveryRequired' } });
    if (kind === 'wrongOrder') {
      await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before));
      await f.setJournal({ current: prepared, next: selected });
    }
    if (kind === 'initialNextSelected') await f.setJournal({ next: prepared });
    const before = await f.snapshot();
    await expect(f.resolve()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.proveTerminal).not.toHaveBeenCalled();
  },
);

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-startup-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const journal = new WorkspaceSwitchJournalStore(root);
  const journalPaths = createWorkspaceSwitchJournalPaths(root);
  await mkdir(journalPaths.directoryPath, { recursive: true, mode: 0o700 });
  const workspace = deriveWorkspaceRoot(root, TEST_TARGET_WORKSPACE_ID, 1);
  await mkdir(workspace.workspaceRoot, { recursive: true, mode: 0o700 });
  await writeFile(registryPath, serializeWorkspaceRegistry(variants.selected), { mode: 0o600 });
  await writeFile(journalPaths.currentPath, serializeVersionedWorkspaceSwitchJournal(selected), { mode: 0o600 });
  const state = { current: true, terminalCurrent: true };
  const assertCurrent = () => { if (!state.current) throw new Error('startup expired'); };
  const assertTerminal = () => { if (!state.terminalCurrent) throw new Error('terminal expired'); };
  const proveTerminal = vi.fn<WorkspaceSelectorSwitchStartupAuthority['proveTerminal']>(async () => ({ assertCurrent: assertTerminal }));
  const authority = { assertCurrent, proveTerminal };
  return Object.assign(state, {
    root, registryPath, registry, journal, journalPaths, assertCurrent, assertTerminal, proveTerminal, authority,
    resolve: () => resolveActiveWorkspaceStartup(root, { selectorAuthority: authority }),
    async resolveSwitch() {
      return resolveWorkspaceSelectorSwitchStartup({ registry, journal, authority,
        selection: { journalSlots: await journal.inspectSlots(), registrySlots: await registry.inspectSlots(),
          readRegistrySlots: () => registry.inspectSlots(), assertAuthority: assertCurrent } });
    },
    async setJournal(values: Partial<Record<'current' | 'next' | 'backup', WorkspaceSwitchJournalV2>>) {
      for (const slot of ['current', 'next', 'backup'] as const) {
        const path = journalPaths[`${slot}Path`];
        await rm(path, { force: true });
        if (values[slot] !== undefined) await writeFile(path, serializeVersionedWorkspaceSwitchJournal(values[slot]), { mode: 0o600 });
      }
    },
    async snapshot() {
      const result: Record<string, string | null> = {};
      for (const [owner, paths] of Object.entries({ registry: { currentPath: registryPath, nextPath: registryPath + '.next', backupPath: registryPath + '.backup' }, journal: journalPaths })) {
        for (const slot of ['current', 'next', 'backup'] as const) {
          try { result[owner + '.' + slot] = (await readFile(paths[`${slot}Path`])).toString('hex'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; result[owner + '.' + slot] = null; }
        }
      }
      return result;
    },
  });
}
