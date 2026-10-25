import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';

import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import {
  assertWorkspaceSwitchTransition, createWorkspaceSwitchJournalPaths, maximumWorkspaceSwitchJournalBytes,
  parseVersionedWorkspaceSwitchJournalBytes, parseWorkspaceSwitchJournalBytes,
  serializeVersionedWorkspaceSwitchJournal, serializeWorkspaceSwitchJournal,
  validateVersionedWorkspaceSwitchJournal, validateWorkspaceSwitchJournal,
  WorkspaceSwitchJournalStore, type WorkspaceSwitchJournal, type WorkspaceSwitchJournalState,
} from './workspaceSwitchJournal.js';
import { planWorkspaceSelectorSwitchSlots } from './workspaceSelectorSwitchSlots.js';
import type { WorkspaceSelectorSwitchSelection } from './workspaceSelectorSwitchSelection.js';
import {
  classifyWorkspaceSelectorSwitch, createWorkspaceSelectorSwitchJournal,
  createWorkspaceSelectorSwitchRegistryVariants,
} from './workspaceSelectorSwitchState.js';
import {
  createSwitchJournal, createSwitchRegistry, TEST_SWITCH_CREATED_AT, TEST_SWITCH_OPERATION_ID,
  TEST_TARGET_WORKSPACE_ID,
} from './workspaceSwitchTestSupport.js';

const variants = createWorkspaceSelectorSwitchRegistryVariants(
  { ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId: null }, TEST_TARGET_WORKSPACE_ID,
);
const prepared = createWorkspaceSelectorSwitchJournal(
  variants.before, TEST_TARGET_WORKSPACE_ID, TEST_SWITCH_OPERATION_ID, TEST_SWITCH_CREATED_AT,
);
const state = (value: WorkspaceSwitchJournalState) => ({ ...prepared, state: value });
const journalBytes = serializeVersionedWorkspaceSwitchJournal;

it.each(['prepared', 'targetSelected', 'rollbackSelected', 'recoveryRequired'] as const)(
  'preserves exact historical v1 bytes and strict v1 consumers for %s', phase => {
    const legacy = createSwitchJournal(phase);
    const expected = Buffer.from(JSON.stringify(legacy) + '\n');
    expect(Buffer.from(serializeWorkspaceSwitchJournal(legacy))).toEqual(expected);
    expect(Buffer.from(journalBytes(legacy))).toEqual(expected);
    expect(parseVersionedWorkspaceSwitchJournalBytes(expected)).toEqual(legacy);
    expect(parseWorkspaceSwitchJournalBytes(expected)).toEqual(legacy);
    const current = state(phase);
    expect(parseVersionedWorkspaceSwitchJournalBytes(journalBytes(current))).toEqual(current);
    expect(Object.isFrozen(parseVersionedWorkspaceSwitchJournalBytes(journalBytes(current)))).toBe(true);
    expect(() => validateWorkspaceSwitchJournal(current)).toThrow('WORKSPACE_SWITCH_INVALID');
    expect(() => parseWorkspaceSwitchJournalBytes(journalBytes(current))).toThrow('WORKSPACE_SWITCH_INVALID');
  },
);

it.each([
  { ...prepared, extra: true }, { ...prepared, sourceWorkspaceId: TEST_TARGET_WORKSPACE_ID },
  { ...prepared, formatVersion: 3 }, { ...prepared, state: 'accepted' },
  { ...prepared, operationId: 'invalid' }, { ...prepared, targetWorkspaceId: '../escape' },
  { ...prepared, createdAt: '2026-10-25' }, { ...prepared, registryBeforeSha256: 'f'.repeat(63) },
  { ...prepared, registrySelectedSha256: 'F'.repeat(64) }, { ...prepared, registryRejectedSha256: null },
])('rejects invalid v2 shape %#', value => {
  expect(() => validateVersionedWorkspaceSwitchJournal(value)).toThrow('WORKSPACE_SWITCH_INVALID');
});

it('rejects duplicate keys, noncanonical bytes, invalid UTF8 and over-budget content', () => {
  const source = Buffer.from(journalBytes(prepared)).toString('utf8');
  for (const bytes of [
    Buffer.from(source.replace('"formatVersion":2', '"formatVersion":2,"formatVersion":2')),
    Buffer.from(source.replace('"state":"prepared"', '"state":"prepared","st\\u0061te":"prepared"')),
    Buffer.from(' ' + source), Buffer.from(source.replace(/\n$/, '')), Buffer.from([0xff]),
    Buffer.alloc(maximumWorkspaceSwitchJournalBytes + 1, 32), Buffer.alloc(0),
  ]) expect(() => parseVersionedWorkspaceSwitchJournalBytes(bytes)).toThrow('WORKSPACE_SWITCH_INVALID');
});

it.each([
  { ...state('targetSelected'), operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { ...state('targetSelected'), targetWorkspaceId: createSwitchRegistry().workspaces[0]!.workspaceId },
  { ...state('targetSelected'), createdAt: '2026-10-25T00:00:00.000Z' },
  ...(['registryBeforeSha256', 'registrySelectedSha256', 'registryRejectedSha256'] as const)
    .map(field => ({ ...state('targetSelected'), [field]: '0'.repeat(64) })),
])('rejects changed operation identity or registry binding %#', next => {
  expect(() => assertWorkspaceSwitchTransition(prepared, next)).toThrow('WORKSPACE_SWITCH_INVALID');
});

it('preserves forward states without allowing an in-flight format change', () => {
  expect(() => assertWorkspaceSwitchTransition(undefined, prepared)).not.toThrow();
  expect(() => assertWorkspaceSwitchTransition(prepared, state('targetSelected'))).not.toThrow();
  expect(() => assertWorkspaceSwitchTransition(state('targetSelected'), state('rollbackSelected'))).not.toThrow();
  for (const [from, to] of [
    [undefined, state('targetSelected')], [state('rollbackSelected'), prepared],
    [createSwitchJournal('prepared'), prepared], [prepared, createSwitchJournal('targetSelected')],
    [state('recoveryRequired'), state('targetSelected')],
  ] as const) expect(() => assertWorkspaceSwitchTransition(from, to)).toThrow('WORKSPACE_SWITCH_INVALID');
});

it.each([
  ['prepared', 'before', 'selectorUncommitted'], ['prepared', 'selected', 'completeSelection'],
  ['targetSelected', 'selected', 'validateTarget'], ['targetSelected', 'before', 'completeReturn'],
  ['targetSelected', 'rejected', 'completeReturn'], ['rollbackSelected', 'before', 'selectorReturned'],
  ['rollbackSelected', 'rejected', 'selectorReturned'], ['recoveryRequired', 'selected', 'recoveryRequired'],
  ['recoveryRequired', 'before', 'recoveryRequired'], ['recoveryRequired', 'rejected', 'recoveryRequired'],
] as const)('classifies persisted %s/%s as %s without granting runtime readiness', (phase, kind, mode) => {
  expect(classifyWorkspaceSelectorSwitch(state(phase), variants[kind])).toBe(mode);
  expect(plan({ current: state(phase) }, { current: variants[kind] }).mode).toBe(mode);
});

it.each([['prepared', 'rejected'], ['rollbackSelected', 'selected']] as const)(
  'rejects impossible %s/%s pairing', (phase, kind) => {
    expect(() => plan({ current: state(phase) }, { current: variants[kind] })).toThrow('WORKSPACE_SWITCH_INVALID');
  },
);

it('requires a ready explicit target and binds every registry entry and lineage', () => {
  for (const registry of [variants.selected, variants.rejected, createSwitchRegistry()]) {
    expect(() => createWorkspaceSelectorSwitchJournal(registry, TEST_TARGET_WORKSPACE_ID,
      TEST_SWITCH_OPERATION_ID, TEST_SWITCH_CREATED_AT)).toThrow('WORKSPACE_SWITCH_INVALID');
  }
  for (const registry of [
    { ...variants.before, workspaces: variants.before.workspaces.map((entry, index) =>
      index === 0 ? { ...entry, workspaceLabel: 'Changed neighbour' } : entry) },
    { ...variants.before, workspaces: variants.before.workspaces.map((entry, index) =>
      index === 1 ? { ...entry, lineageIdentity: { formatVersion: 1 as const, profileId: 'c'.repeat(64) } } : entry) },
    { ...variants.before, activeWorkspaceId: variants.before.workspaces[0]!.workspaceId },
    { ...variants.before, workspaces: variants.before.workspaces.slice(0, 1) },
  ]) expect(() => plan({ current: prepared }, { current: registry })).toThrow('WORKSPACE_SWITCH_INVALID');
});

it.for([
  { current: 'prepared', next: 'targetSelected' }, { backup: 'prepared', next: 'targetSelected' },
  { current: 'targetSelected', backup: 'prepared' }, { backup: 'targetSelected' },
] as const)('inspects actual interrupted journal slots without repairing %#', async (phases, test) => {
  const f = await fixture(test);
  const journals: Values<WorkspaceSwitchJournal> = {};
  for (const slot of slots) {
    const phase = phases[slot as keyof typeof phases];
    if (phase !== undefined) journals[slot] = state(phase);
  }
  await f.write(journals, { current: variants.selected });
  const before = await f.snapshot();
  expect(['completeSelection', 'validateTarget']).toContain((await f.inspect()).mode);
  expect(await f.snapshot()).toEqual(before);
  expect((await f.inspect()).journal).toEqual(journals.current ?? journals.backup);
});

it.for([
  { current: 'before', next: 'selected' }, { backup: 'before', next: 'selected' },
  { current: 'selected', backup: 'before' }, { backup: 'selected' },
] as const)('inspects actual interrupted registry slots without inventing a source %#', async (kinds, test) => {
  const f = await fixture(test);
  const registries: Values<LocalWorkspaceRegistry> = {};
  for (const slot of slots) {
    const kind = kinds[slot as keyof typeof kinds];
    if (kind !== undefined) registries[slot] = variants[kind];
  }
  await f.write({ current: prepared }, registries);
  const before = await f.snapshot();
  const actual = await f.inspect();
  expect(actual.registry).toEqual(registries.current ?? registries.backup);
  expect(actual.mode).toBe(actual.registry.activeWorkspaceId === null ? 'selectorUncommitted' : 'completeSelection');
  expect(await f.snapshot()).toEqual(before);
});

it('keeps initial-next preparation unpublished and rejects conflicting publication order', () => {
  expect(plan({ next: prepared }, { current: variants.before }).mode).toBe('unpublishedPreparation');
  const p = prepared; const t = state('targetSelected'); const r = state('rollbackSelected');
  const b = variants.before; const s = variants.selected; const rejected = variants.rejected;
  for (const [journals, registries] of [
    [{ next: p }, { current: s }], [{ next: t }, { current: b }],
    [{ current: p, backup: p, next: t }, { current: b }], [{ current: p, backup: t }, { current: b }],
    [{ current: p }, { next: b }], [{ current: p }, { current: b, next: s, backup: b }],
    [{ current: p }, { current: b, backup: rejected }],
    [{ current: p, next: t }, { current: b }], [{ current: t, next: r }, { current: s }],
    [{ current: p, next: t }, { current: s, backup: b }],
    [{ current: r }, { current: b, backup: s }], [{ current: p }, { current: s, next: rejected }],
    [{ current: p, next: { ...t, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }, { current: s }],
    [{ current: createSwitchJournal('prepared') }, { current: s }],
    [{ current: p }, { current: createSwitchRegistry() }],
  ] as const) expect(() => plan(journals, registries)).toThrow('WORKSPACE_SWITCH_INVALID');
});

it.each(['before', 'rejected'] as const)('admits rollback intent only after the published %s registry', kind => {
  expect(plan({ current: state('targetSelected'), next: state('rollbackSelected') },
    { current: variants[kind] }).mode).toBe('completeReturn');
});

it.for(['journal', 'registry'] as const)('preserves all actual slots on an invalid %s sibling', async (owner, test) => {
  const f = await fixture(test);
  await f.write({ current: prepared }, { current: variants.before });
  const path = owner === 'journal' ? f.journalPaths.nextPath : f.registryPath + '.next';
  await writeFile(path, Buffer.from('{"formatVersion":'), { flag: 'wx' });
  const before = await f.snapshot();
  await expect(f.inspect()).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['read', 'write', 'clear'] as const)('does not let the v1 %s path mutate a v2 current journal', async (operation, test) => {
  const f = await fixture(test);
  await f.write({ current: prepared, next: state('targetSelected') }, { current: variants.selected });
  const before = await f.snapshot();
  const store = new WorkspaceSwitchJournalStore(f.root);
  await expect(operation === 'read' ? store.read() : operation === 'write'
    ? store.write(createSwitchJournal('prepared')) : store.clear(TEST_SWITCH_OPERATION_ID))
    .rejects.toThrow('WORKSPACE_SWITCH_INVALID');
  expect(await f.snapshot()).toEqual(before);
});

it('publishes through the real selected stores and requires a separate current terminal before clear', async test => {
  const f = await fixture(test);
  await f.write({}, { current: variants.before });
  await f.journal.writeSelector(prepared, await f.selection());
  await f.journal.writeSelector(prepared, await f.selection());
  const before = await f.snapshot();
  await expect(f.journal.writeSelector(state('targetSelected'), await f.selection())).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  await f.registry.writeSelected(variants.selected, await f.registrySelection());
  await f.journal.writeSelector(state('targetSelected'), await f.selection());
  expect((await f.inspect()).mode).toBe('validateTarget');
  const selected = await f.snapshot();
  await expect(f.journal.clearSelector(await f.selection(), {
    purpose: 'acceptedTarget', assertCurrent() { throw new Error('BUSINESS_NOT_READY'); },
  })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(selected);
  await f.journal.clearSelector(await f.selection(), { purpose: 'acceptedTarget', assertCurrent() {} });
  expect((await f.snapshot()).slice(0, 3)).toEqual([undefined, undefined, undefined]);
  expect(await f.registry.inspect()).toEqual(variants.selected);
});

it.for(['before', 'rejected'] as const)('publishes and clears only the admitted %s return', async (kind, test) => {
  const f = await fixture(test);
  await f.write({ current: state('targetSelected') }, { current: variants.selected });
  await expect(f.journal.writeSelector(state('rollbackSelected'), await f.selection())).rejects.toThrow();
  await f.registry.writeSelected(variants[kind], await f.registrySelection());
  await f.journal.writeSelector(state('rollbackSelected'), await f.selection());
  expect((await f.inspect()).mode).toBe('selectorReturned');
  await f.journal.clearSelector(await f.selection(), { purpose: 'selectorReturn', assertCurrent() {} });
  expect(await f.registry.inspect()).toEqual(variants[kind]);
});

it.for([
  { current: 'targetSelected', next: 'rollbackSelected' },
  { backup: 'targetSelected', next: 'rollbackSelected' },
  { current: 'rollbackSelected', backup: 'targetSelected' },
  { backup: 'rollbackSelected' },
  { current: 'rollbackSelected', next: 'rollbackSelected' },
] as const)('repairs admitted return slots using exact selected bytes %#', async (phases, test) => {
  const f = await fixture(test);
  const journals: Values<WorkspaceSwitchJournal> = {};
  for (const slot of slots) {
    const phase = phases[slot as keyof typeof phases];
    if (phase !== undefined) journals[slot] = state(phase);
  }
  await f.write(journals, { current: variants.before });
  await f.journal.recoverSelector(await f.selection());
  const observed = await f.journal.inspectSlots();
  expect(observed.current?.value).toEqual(journals.current ?? journals.backup);
  expect([observed.next, observed.backup]).toEqual([undefined, undefined]);
  expect(await f.registry.inspect()).toEqual(variants.before);
});

it('does not promote unpublished next and needs current absence authority to discard it', async test => {
  const f = await fixture(test);
  await f.write({ next: prepared }, { current: variants.before });
  const before = await f.snapshot();
  await expect(f.journal.recoverSelector(await f.selection())).rejects.toThrow();
  await expect(f.journal.clearSelector(await f.selection(), {
    purpose: 'selectorReturn', assertCurrent() { throw new Error('RUNTIME_UNCERTAIN'); },
  })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  await f.journal.clearSelector(await f.selection(), { purpose: 'selectorReturn', assertCurrent() {} });
  expect((await f.snapshot()).slice(0, 3)).toEqual([undefined, undefined, undefined]);
  expect(await f.registry.inspect()).toEqual(variants.before);
});

it.for(['write', 'recover', 'clear'] as const)('preserves all files when the registry changes before selector %s', async (operation, test) => {
  const f = await fixture(test);
  await f.write({ current: prepared }, { current: variants.before });
  const selection = await f.selection();
  await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.selected));
  const before = await f.snapshot();
  await expect(operation === 'write' ? f.journal.writeSelector(prepared, selection)
    : operation === 'recover' ? f.journal.recoverSelector(selection)
      : f.journal.clearSelector(selection, { purpose: 'selectorReturn', assertCurrent() {} })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('preserves a pending registry publication at terminal clear', async test => {
  const f = await fixture(test);
  await f.write({ current: prepared }, { current: variants.before, next: variants.selected });
  const before = await f.snapshot();
  await expect(f.journal.clearSelector(await f.selection(), { purpose: 'selectorReturn', assertCurrent() {} })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('does not repair or clear a recoveryRequired selector journal', async test => {
  const f = await fixture(test);
  await f.write({ current: state('recoveryRequired'), backup: state('targetSelected') }, { current: variants.selected });
  const before = await f.snapshot();
  await expect(f.journal.recoverSelector(await f.selection())).rejects.toThrow();
  for (const purpose of ['selectorReturn', 'acceptedTarget'] as const) {
    await expect(f.journal.clearSelector(await f.selection(), { purpose, assertCurrent() {} })).rejects.toThrow();
  }
  expect(await f.snapshot()).toEqual(before);
});

it('rejects expired authority after the external read without touching either owner', async test => {
  const f = await fixture(test);
  await f.write({ current: prepared }, { current: variants.before });
  const selection = await f.selection();
  const before = await f.snapshot();
  let live = true;
  await expect(f.journal.writeSelector(prepared, { ...selection,
    async readRegistrySlots() { const actual = await f.registry.inspectSlots(); live = false; return actual; },
    assertAuthority() { if (!live) throw new Error('EXPIRED'); },
  })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('rejects selected registry downgrade without touching either owner', async test => {
  const f = await fixture(test);
  await f.write({ current: prepared }, { current: variants.before });
  const before = await f.snapshot();
  await expect(f.registry.writeSelected(createSwitchRegistry(), await f.registrySelection())).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

type Values<T> = Partial<Record<'current' | 'next' | 'backup', T>>;
const slots = ['current', 'next', 'backup'] as const;
function records<T>(values: Values<T>, serialize: (value: T) => Uint8Array): ReadOnlyJournalSlots<T> {
  return Object.fromEntries(slots.map(slot => [slot, values[slot] === undefined ? undefined
    : { bytes: serialize(values[slot]!), value: values[slot]! }])) as ReadOnlyJournalSlots<T>;
}
function plan(journals: Values<WorkspaceSwitchJournal>, registries: Values<LocalWorkspaceRegistry>) {
  return planWorkspaceSelectorSwitchSlots(records(journals, journalBytes), records(registries, serializeWorkspaceRegistry));
}
async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-switch-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const journalPaths = createWorkspaceSwitchJournalPaths(root);
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  await mkdir(journalPaths.directoryPath, { mode: 0o700 });
  const paths = [journalPaths.currentPath, journalPaths.nextPath, journalPaths.backupPath,
    registryPath, registryPath + '.next', registryPath + '.backup'];
  const journal = new WorkspaceSwitchJournalStore(root);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  return {
    root, journalPaths, registryPath, journal, registry,
    async selection(): Promise<WorkspaceSelectorSwitchSelection> {
      return { journalSlots: await journal.inspectSlots(), registrySlots: await registry.inspectSlots(),
        readRegistrySlots: () => registry.inspectSlots(), assertAuthority() {} };
    },
    async registrySelection(): Promise<CrashSafeByteSlotSelection> {
      const observed = await registry.inspectSlots();
      const external = await journal.inspectSlots();
      return {
        expectedSlots: { current: observed.current?.bytes, next: observed.next?.bytes, backup: observed.backup?.bytes },
        expectedIdentities: { current: observed.current?.identity, next: observed.next?.identity, backup: observed.backup?.identity },
        assertAuthority() {},
        async assertExternalSelection() { expect(await journal.inspectSlots()).toEqual(external); },
      };
    },
    async write(journals: Values<WorkspaceSwitchJournal>, registries: Values<LocalWorkspaceRegistry>) {
      for (const slot of slots) {
        const journal = journals[slot]; const registry = registries[slot];
        if (journal !== undefined) await writeFile(journalPaths[`${slot}Path`], journalBytes(journal), { flag: 'wx', mode: 0o600 });
        if (registry !== undefined) await writeFile(registryPath + (slot === 'current' ? '' : '.' + slot),
          serializeWorkspaceRegistry(registry), { flag: 'wx', mode: 0o600 });
      }
    },
    async snapshot() {
      return Promise.all(paths.map(async path => {
        try { return await readFile(path); }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
      }));
    },
    async inspect() {
      return planWorkspaceSelectorSwitchSlots(await journal.inspectSlots(), await registry.inspectSlots());
    },
  };
}
