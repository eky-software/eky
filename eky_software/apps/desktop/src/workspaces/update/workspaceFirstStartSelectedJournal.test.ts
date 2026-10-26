import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { serializeWorkspaceFirstStartMigrationJournal, validateWorkspaceFirstStartMigrationJournal,
  WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES } from './workspaceFirstStartMigrationJournalCodec.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from './workspaceFirstStartMigrationJournalPaths.js';
import { WorkspaceFirstStartMigrationJournalStore } from './workspaceFirstStartMigrationJournalStore.js';
import type { WorkspaceFirstStartMigrationJournalV1 } from './workspaceFirstStartMigrationJournalTypes.js';

const prepared = validateWorkspaceFirstStartMigrationJournal({
  formatVersion: 1, operationId: '00000000-0000-4000-8000-000000000001', state: 'prepared',
  sourceBuild: { appVersion: '0.2.6', buildRevision: 'a'.repeat(40) },
  targetBuild: { appVersion: '0.2.7', buildRevision: 'b'.repeat(40) },
  activeWorkspaceId: validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
  passiveRecoveryWorkspaceIds: [validateWorkspaceId('22222222-2222-4222-8222-222222222222')],
  sourceRegistrySha256: 'c'.repeat(64), transitionedRegistrySha256: 'd'.repeat(64),
  createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
});
const transitioned = validateWorkspaceFirstStartMigrationJournal({ ...prepared,
  state: 'registryTransitioned', updatedAt: '2026-08-21T00:00:01.000Z' });
type Slot = 'current' | 'next' | 'backup';
const names = ['current', 'next', 'backup'] as const;

it('publishes preparation and transition with writer identities, then removes the exact journal', async test => {
  const f = await fixture(test);
  for (const value of [prepared, transitioned]) {
    const identity = await f.store.writeSelected(value, await f.selection());
    const observed = await f.store.inspectSlots();
    expect(observed.current?.value).toEqual(value);
    expect(observed.current?.identity).toEqual(identity);
    expect(observed.next).toBeUndefined();
    expect(observed.backup).toBeUndefined();
  }
  await f.store.removeSelected(prepared.operationId, 'registryTransitioned', await f.selection());
  expect(await f.store.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
});

it.for([
  { current: prepared, next: transitioned, expected: prepared },
  { backup: prepared, next: transitioned, expected: prepared },
  { current: transitioned, backup: prepared, expected: transitioned },
  { backup: prepared, expected: prepared },
  { next: prepared, expected: prepared },
] as const)('recovers only the admitted W6 interruption %#', async (initial, test) => {
  const f = await fixture(test, initial);
  const before = await f.store.inspectSlots();
  await f.store.recoverSelected(await f.selection());
  const after = await f.store.inspectSlots();
  expect(after.current?.value).toEqual(initial.expected);
  expect(after.current?.identity?.ino).toBe((before.current ?? before.backup ?? before.next)?.identity?.ino);
  expect(after.next).toBeUndefined();
  expect(after.backup).toBeUndefined();
});

it.for([
  { next: transitioned },
  { current: transitioned, next: prepared },
  { backup: transitioned, current: prepared },
  { current: prepared, next: transitioned, backup: prepared },
  { current: prepared, next: { ...transitioned, operationId: '00000000-0000-4000-8000-000000000002' } },
] as const)('preserves unsupported publication order or foreign operation %#', async (initial, test) => {
  const f = await fixture(test, initial);
  const before = await f.snapshot();
  await expect(f.store.recoverSelected(await f.selection())).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['write', 'recover', 'remove'] as const)('rejects stale authority and same-byte replacements before %s', async (operation, test) => {
  const f = await fixture(test, { current: prepared });
  const selection = await f.selection();
  const before = await f.snapshot();
  await expect(f.run(operation, { ...selection, assertAuthority() { throw new Error('EXPIRED'); } })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  await rename(f.path('current'), join(f.root, 'original'));
  await writeFile(f.path('current'), before.current!, { flag: 'wx' });
  await expect(f.run(operation, selection)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect((await readFile(join(f.root, 'original'))).equals(before.current!)).toBe(true);
});

it.for(['write', 'recover', 'remove'] as const)('checks external selection inside %s', async (operation, test) => {
  const f = await fixture(test, { current: prepared });
  const before = await f.snapshot();
  await expect(f.run(operation, { ...await f.selection(), async assertExternalSelection() {
    throw new Error('REGISTRY_CHANGED');
  } })).rejects.toThrow('REGISTRY_CHANGED');
  expect(await f.snapshot()).toEqual(before);
});

it.for(['prepared', 'registryTransitioned'] as const)('cannot remove the wrong %s operation or state', async (state, test) => {
  const f = await fixture(test, { current: state === 'prepared' ? prepared : transitioned });
  const before = await f.snapshot();
  const selection = await f.selection();
  await expect(f.store.removeSelected('00000000-0000-4000-8000-000000000002', state, selection)).rejects.toThrow();
  await expect(f.store.removeSelected(prepared.operationId, state === 'prepared' ? 'registryTransitioned' : 'prepared', selection)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('keeps an interrupted publication for a fresh owner instead of rolling it back', async test => {
  const f = await fixture(test, { current: prepared });
  const sync = vi.spyOn(f.fs, 'syncDirectory').mockRejectedValueOnce(new Error('ACK_LOST'));
  await expect(f.store.writeSelected(transitioned, await f.selection())).rejects.toThrow('ACK_LOST');
  const interrupted = await f.store.inspectSlots();
  expect(interrupted.current?.value).toEqual(transitioned);
  expect(interrupted.backup?.value).toEqual(prepared);
  sync.mockRestore();
  const restarted = new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.root });
  await restarted.recoverSelected(await f.selection());
  expect((await restarted.inspectSlots()).current?.value).toEqual(transitioned);
  expect((await restarted.inspectSlots()).backup).toBeUndefined();
});

it('retains the exact first failure when its owned writer also fails to close', async test => {
  const f = await fixture(test, { current: prepared });
  const create = f.fs.createNextWriter.bind(f.fs);
  const first = new Error('WRITE_FAILED');
  const closing = new Error('CLOSE_FAILED');
  let closed = false;
  vi.spyOn(f.fs, 'createNextWriter').mockImplementation(async guard => {
    const writer = await create(guard);
    return { ...writer, async write() { throw first; },
      async close() { await writer.close(); closed = true; throw closing; } };
  });
  const error = await f.store.writeSelected(transitioned, await f.selection()).catch(value => value);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([first, closing]);
  expect(closed).toBe(true);
  const after = await f.snapshot();
  expect(after.current?.equals(Buffer.from(serializeWorkspaceFirstStartMigrationJournal(prepared)))).toBe(true);
  expect(after.next?.length).toBe(0);
});

async function fixture(test: TestContext, initial: Partial<Record<Slot, WorkspaceFirstStartMigrationJournalV1>> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6-selected-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = createWorkspaceFirstStartMigrationJournalPaths(root);
  await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 });
  const path = (slot: Slot) => paths[`${slot}Path`];
  for (const slot of names) if (initial[slot] !== undefined) {
    await writeFile(path(slot), serializeWorkspaceFirstStartMigrationJournal(initial[slot]), { flag: 'wx', mode: 0o600 });
  }
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES);
  const store = new WorkspaceFirstStartMigrationJournalStore({ userDataPath: root, fileSystem: fs });
  const selection = async (): Promise<CrashSafeByteSlotSelection> => {
    const slots = await store.inspectSlots();
    return { expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
      expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity },
      assertAuthority() {}, async assertExternalSelection() {} };
  };
  const snapshot = async () => {
    const result: Record<Slot, Buffer | undefined> = { current: undefined, next: undefined, backup: undefined };
    for (const slot of names) {
      try { result[slot] = await readFile(path(slot)); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    return result;
  };
  return { root, path, fs, store, selection, snapshot,
    run(operation: 'write' | 'recover' | 'remove', selected: CrashSafeByteSlotSelection) {
      if (operation === 'write') return store.writeSelected(transitioned, selected);
      if (operation === 'recover') return store.recoverSelected(selected);
      return store.removeSelected(prepared.operationId, 'prepared', selected);
    },
  };
}
