import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import { CrashSafeByteSlotStore, type CrashSafeByteSlotSelection, type SelectedByteSlots } from './crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlot, type CrashSafeFileSlotIdentity } from './crashSafeFileSlot.js';

const names = ['current', 'next', 'backup'] as const;
const bytes = (text: string) => Buffer.from(text);

it('keeps empty-file observation separate from normal reads and mutation authority', async test => {
  const f = await fixture(test, { current: 'old' });
  await writeFile(f.path('next'), bytes(''));
  await expect(f.fs.readSlot('next')).rejects.toThrow();
  let identity: CrashSafeFileSlotIdentity | undefined;
  await expect(f.fs.readSlot('next', value => { identity = value; }, 'allowEmptyObservation')).resolves.toEqual(new Uint8Array(0));
  expect(identity?.size).toBe(0);
  expect(identity?.ino).not.toBe(0);
  await expect(f.fs.readSlot('next')).rejects.toThrow();
  expect(await readFile(f.path('current'))).toEqual(bytes('old'));
  expect(await readFile(f.path('next'))).toEqual(bytes(''));
});

it.for([false, true])('publishes selected bytes with previous current: %s', async (present, test) => {
  const f = await fixture(test, present ? { current: 'old' } : {});
  const external = vi.fn(async () => undefined);
  const identity = await f.store.replaceSelected(bytes('new'), { ...await f.selection(), assertExternalSelection: external });
  expect(await f.snapshot()).toEqual({ current: bytes('new'), next: undefined, backup: undefined });
  expect(identity).toEqual((await f.selection()).expectedIdentities.current);
  expect(Object.isFrozen(identity)).toBe(true);
  expect(external.mock.calls.length).toBeGreaterThan(4);
});

it.for([
  { current: 'old', next: 'new', expected: 'old' },
  { backup: 'old', next: 'new', expected: 'old' },
  { current: 'new', backup: 'old', expected: 'new' },
  { backup: 'old', expected: 'old' },
] as const)('recovers exactly the admitted published bytes %#', async (input, test) => {
  const f = await fixture(test, input);
  const identity = await f.store.recoverSelected(await f.selection());
  expect(await f.snapshot()).toEqual({ current: bytes(input.expected), next: undefined, backup: undefined });
  expect(identity).toEqual((await f.selection()).expectedIdentities.current);
  expect(Object.isFrozen(identity)).toBe(true);
});

it.for([{ next: 'unpublished' }, { current: 'new', backup: 'old', next: 'other' }])(
  'does not invent selected recovery for ambiguous slots %#', async (input, test) => {
    const f = await fixture(test, input);
    const before = await f.snapshot();
    await expect(f.store.recoverSelected(await f.selection())).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  },
);

it('promotes an explicitly admitted initial next with its original identity', async test => {
  const f = await fixture(test, { next: 'initial' });
  const selected = await f.selection();
  const identity = await f.store.promoteInitialSelected(selected);
  expect(identity.ino).toBe(selected.expectedIdentities.next?.ino);
  expect(identity).toEqual((await f.selection()).expectedIdentities.current);
  expect(await f.snapshot()).toEqual({ current: bytes('initial'), next: undefined, backup: undefined });
});

it.for([{}, { current: 'old', next: 'new' }, { backup: 'old', next: 'new' }] as const)(
  'never promotes an initial next over another selection %#', async (initial, test) => {
    const f = await fixture(test, initial);
    const before = await f.snapshot();
    await expect(f.store.promoteInitialSelected(await f.selection())).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  },
);

it.for(['external', 'identity', 'move', 'sync'] as const)(
  'preserves the initial publication on %s failure', async (phase, test) => {
    const f = await fixture(test, { next: 'initial' });
    const selection = await f.selection();
    let live = true;
    if (phase === 'external') selection.assertExternalSelection = async () => { throw new Error('EXTERNAL_CHANGED'); };
    if (phase === 'identity') {
      await rename(f.path('next'), join(f.root, 'original'));
      await writeFile(f.path('next'), bytes('initial'), { flag: 'wx' });
    }
    if (phase === 'move') {
      const move = f.fs.moveSlot.bind(f.fs);
      vi.spyOn(f.fs, 'moveSlot').mockImplementation(async (...args) => { await move(...args); live = false; });
    }
    if (phase === 'sync') vi.spyOn(f.fs, 'syncDirectory').mockRejectedValue(new Error('SYNC_FAILED'));
    await expect(f.store.promoteInitialSelected({ ...selection,
      assertAuthority() { if (!live) throw new Error('EXPIRED'); },
    })).rejects.toThrow();
    const published = phase === 'move' || phase === 'sync';
    expect(await f.snapshot()).toEqual({ current: published ? bytes('initial') : undefined,
      next: published ? undefined : bytes('initial'), backup: undefined });
    if (phase === 'identity') expect(await readFile(join(f.root, 'original'))).toEqual(bytes('initial'));
  },
);

it.for(['replace', 'recover', 'clear'] as const)('rejects changed own bytes before %s', async (operation, test) => {
  const f = await fixture(test, { current: 'old' });
  const selection = await f.selection();
  await writeFile(f.path('current'), bytes('changed'));
  const before = await f.snapshot();
  await expect(f.run(operation, selection)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['replace', 'recover', 'clear'] as const)('preserves all slots after external selection changes before %s', async (operation, test) => {
  const f = await fixture(test, { current: 'old' });
  const selection = await f.selection();
  const before = await f.snapshot();
  await expect(f.run(operation, { ...selection, assertExternalSelection: async () => { throw new Error('EXTERNAL_CHANGED'); } }))
    .rejects.toThrow('EXTERNAL_CHANGED');
  expect(await f.snapshot()).toEqual(before);
});

it.for(['replace', 'recover', 'clear'] as const)('rejects expired or asynchronous authority before %s', async (operation, test) => {
  const f = await fixture(test, { current: 'old' });
  const before = await f.snapshot();
  for (const assertAuthority of [() => { throw new Error('EXPIRED'); }, async () => undefined]) {
    await expect(f.run(operation, { ...await f.selection(), assertAuthority })).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  }
});

it.for(['nextCreated', 'written', 'synced', 'closed', 'backupMoved', 'published', 'directorySynced', 'backupRemoved'] as const)(
  'retains the exact interruption slots and closes the owned writer after %s', async (phase, test) => {
    const f = await fixture(test, { current: 'old' });
    let live = true;
    let writerClosed = false;
    const create = f.fs.createNextWriter.bind(f.fs);
    vi.spyOn(f.fs, 'createNextWriter').mockImplementation(async guard => {
      const writer = await create(guard);
      if (phase === 'nextCreated') live = false;
      return {
        readIdentity: () => writer.readIdentity!(),
        async write(value) { const result = await writer.write(value); if (phase === 'written') live = false; return result; },
        async sync() { await writer.sync(); if (phase === 'synced') live = false; },
        async close() { await writer.close(); writerClosed = true; if (phase === 'closed') live = false; },
      };
    });
    const move = f.fs.moveSlot.bind(f.fs);
    vi.spyOn(f.fs, 'moveSlot').mockImplementation(async (from, to, guard) => {
      await move(from, to, guard);
      if ((to === 'backup' && phase === 'backupMoved') || (to === 'current' && phase === 'published')) live = false;
    });
    const sync = f.fs.syncDirectory.bind(f.fs);
    vi.spyOn(f.fs, 'syncDirectory').mockImplementation(async guard => {
      await sync(guard); if (phase === 'directorySynced') live = false;
    });
    const remove = f.fs.removeSlot.bind(f.fs);
    vi.spyOn(f.fs, 'removeSlot').mockImplementation(async (slot, guard) => {
      const result = await remove(slot, guard); if (phase === 'backupRemoved') live = false; return result;
    });
    await expect(f.store.replaceSelected(bytes('new'), { ...await f.selection(),
      assertAuthority() { if (!live) throw new Error('EXPIRED'); },
    })).rejects.toThrow();
    expect(writerClosed).toBe(true);
    const snapshot = await f.snapshot();
    const early = ['nextCreated', 'written', 'synced', 'closed'].includes(phase);
    expect(snapshot).toEqual(early
      ? { current: bytes('old'), next: bytes(phase === 'nextCreated' ? '' : 'new'), backup: undefined }
      : phase === 'backupMoved'
        ? { current: undefined, next: bytes('new'), backup: bytes('old') }
        : { current: bytes('new'), next: undefined, backup: phase === 'backupRemoved' ? undefined : bytes('old') });
  },
);

it.for(['remove', 'move'] as const)('rejects same-byte file replacement inside the %s boundary', async (operation, test) => {
  const f = await fixture(test, { current: 'old' });
  const guard = {
    assertAuthority() {},
    async beforeMutation() {
      await rename(f.path('current'), join(f.root, 'preserved-original'));
      await writeFile(f.path('current'), bytes('old'), { flag: 'wx', mode: 0o600 });
    },
  };
  await expect(operation === 'remove' ? f.fs.removeSlot('current', guard)
    : f.fs.moveSlot('current', 'backup', guard)).rejects.toThrow();
  expect(await readFile(join(f.root, 'preserved-original'))).toEqual(bytes('old'));
  expect(await f.snapshot()).toEqual({ current: bytes('old'), backup: undefined, next: undefined });
});

it('retains a short-write next and never overwrites current on writer failure', async test => {
  const f = await fixture(test, { current: 'old' });
  const create = f.fs.createNextWriter.bind(f.fs);
  vi.spyOn(f.fs, 'createNextWriter').mockImplementation(async guard => {
    const writer = await create(guard);
    return { readIdentity: () => writer.readIdentity!(), write: value => writer.write(value.subarray(0, 1)), sync: () => writer.sync(), close: () => writer.close() };
  });
  await expect(f.store.replaceSelected(bytes('new'), await f.selection())).rejects.toThrow();
  expect(await f.snapshot()).toEqual({ current: bytes('old'), next: bytes('n'), backup: undefined });
});

it('copies expected bytes before external awaits and refuses mutations to the caller observation', async test => {
  const f = await fixture(test, { current: 'old' });
  const selection = await f.selection();
  await expect(f.store.clearSelected({ ...selection, async assertExternalSelection() {
    selection.expectedSlots.current!.fill(120);
    await writeFile(f.path('current'), bytes('xxx'));
  } })).rejects.toThrow();
  expect(await readFile(f.path('current'))).toEqual(bytes('xxx'));
});

it('preserves selection identity before the filesystem mutation begins', async test => {
  const f = await fixture(test, { current: 'old' });
  const selection = await f.selection();
  await rename(f.path('current'), join(f.root, 'original'));
  await writeFile(f.path('current'), bytes('old'), { flag: 'wx', mode: 0o600 });
  await expect(f.store.clearSelected(selection)).rejects.toThrow();
  expect(await readFile(join(f.root, 'original'))).toEqual(bytes('old'));
  expect(await f.snapshot()).toEqual({ current: bytes('old'), next: undefined, backup: undefined });
});

it('closes after write failure and retains both first and close failures', async test => {
  const f = await fixture(test, { current: 'old' });
  const original = new Error('WRITE_FAILED');
  const closing = new Error('CLOSE_FAILED');
  let closed = false;
  const create = f.fs.createNextWriter.bind(f.fs);
  vi.spyOn(f.fs, 'createNextWriter').mockImplementation(async guard => {
    const writer = await create(guard);
    return {
      readIdentity: () => writer.readIdentity!(),
      async write() { throw original; }, sync: () => writer.sync(),
      async close() { await writer.close(); closed = true; throw closing; },
    };
  });
  const result = await f.store.replaceSelected(bytes('new'), await f.selection()).catch(error => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toEqual([original, closing]);
  expect(closed).toBe(true);
  expect(await f.snapshot()).toEqual({ current: bytes('old'), next: bytes(''), backup: undefined });
});

it.for(['remove', 'move'] as const)('renews authority inside the final %s filesystem boundary', async (operation, test) => {
  const f = await fixture(test, { current: 'old' });
  let live = true;
  const guard = { async beforeMutation() { live = false; }, assertAuthority() { if (!live) throw new Error('EXPIRED'); } };
  await expect(operation === 'remove' ? f.fs.removeSlot('current', guard)
    : f.fs.moveSlot('current', 'backup', guard)).rejects.toThrow();
  expect(await f.snapshot()).toEqual({ current: bytes('old'), next: undefined, backup: undefined });
});

it('retains published bytes on lost acknowledgement and permits a fresh selected recovery', async test => {
  const f = await fixture(test, { current: 'old' });
  const sync = vi.spyOn(f.fs, 'syncDirectory').mockRejectedValueOnce(new Error('ACK_LOST'));
  await expect(f.store.replaceSelected(bytes('new'), await f.selection())).rejects.toThrow('ACK_LOST');
  expect(await f.snapshot()).toEqual({ current: bytes('new'), backup: bytes('old'), next: undefined });
  sync.mockRestore();
  await new CrashSafeByteSlotStore(f.fs).recoverSelected(await f.selection());
  expect(await f.snapshot()).toEqual({ current: bytes('new'), backup: undefined, next: undefined });
});

it('retains later slots when authority expires during clear', async test => {
  const f = await fixture(test, { current: 'current', next: 'next', backup: 'backup' });
  let live = true;
  const remove = f.fs.removeSlot.bind(f.fs);
  vi.spyOn(f.fs, 'removeSlot').mockImplementation(async (slot, guard) => {
    const result = await remove(slot, guard); live = false; return result;
  });
  await expect(f.store.clearSelected({ ...await f.selection(), assertAuthority() { if (!live) throw new Error('EXPIRED'); } }))
    .rejects.toThrow();
  expect(await f.snapshot()).toEqual({ current: bytes('current'), next: undefined, backup: bytes('backup') });
});

async function fixture(test: TestContext, initial: Partial<Record<CrashSafeFileSlot, string>>) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selected-slots-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const directoryPath = join(root, 'state');
  await mkdir(directoryPath, { mode: 0o700 });
  const path = (slot: CrashSafeFileSlot) => join(directoryPath, `journal.${slot}`);
  for (const slot of names) if (initial[slot] !== undefined) await writeFile(path(slot), bytes(initial[slot]!), { flag: 'wx', mode: 0o600 });
  const fs = createNodeCrashSafeFileSlotFileSystem({ directoryPath, currentPath: path('current'), nextPath: path('next'), backupPath: path('backup') }, 4096);
  const store = new CrashSafeByteSlotStore(fs);
  const snapshot = async (): Promise<SelectedByteSlots> => {
    const slots: Record<CrashSafeFileSlot, Uint8Array | undefined> = { current: undefined, next: undefined, backup: undefined };
    for (const slot of names) {
      try { slots[slot] = await readFile(path(slot)); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    return slots;
  };
  const selection = async (): Promise<CrashSafeByteSlotSelection> => {
    const expectedSlots: Record<CrashSafeFileSlot, Uint8Array | undefined> = { current: undefined, next: undefined, backup: undefined };
    const expectedIdentities: Record<CrashSafeFileSlot, CrashSafeFileSlotIdentity | undefined> = { current: undefined, next: undefined, backup: undefined };
    for (const slot of names) expectedSlots[slot] = await fs.readSlot(slot, value => { expectedIdentities[slot] = value; });
    return { expectedSlots, expectedIdentities, assertAuthority() {}, async assertExternalSelection() {} };
  };
  return { root, path, fs, store, snapshot, selection,
    run(operation: 'replace' | 'recover' | 'clear', selected: CrashSafeByteSlotSelection) {
      if (operation === 'replace') return store.replaceSelected(bytes('new'), selected);
      if (operation === 'recover') return store.recoverSelected(selected);
      return store.clearSelected(selected);
    },
  };
}
