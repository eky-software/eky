import { readdir, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it, vi, type TestContext } from 'vitest';
import { type CrashSafeByteSlotReadSelection } from "../persistence/crashSafeByteSlotStore.js";
import { deletionTestJournal as journal } from "./workspaceDeletionDataTestSupport.js";
import { serializeWorkspaceDeletionJournal } from "./workspaceDeletionJournalCodec.js";
import { createWorkspaceDeletionJournalReadFixture, publishedDeletionJournalPlan as publishedPlan } from './workspaceDeletionJournalReadTestSupport.js';
import { WorkspaceDeletionJournalStore } from "./workspaceDeletionJournalStore.js";
function fixture(test: TestContext, mode: Parameters<typeof createWorkspaceDeletionJournalReadFixture>[2] = 'published') {
  return createWorkspaceDeletionJournalReadFixture(test, io, mode);
}

const io = vi.hoisted(() => ({
  root: '', path: '', beforeRead: undefined as (() => Promise<void>) | undefined,
  beforeClose: undefined as (() => Promise<void>) | undefined, handles: [] as FileHandle[], live: new Set<FileHandle>()
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual, async open(...args: Parameters<typeof actual.open>) {
      const file = await actual.open(...args);
      if (!io.root || typeof args[0] !== 'string' || !args[0].startsWith(io.root))
        return file;
      io.handles.push(file);
      io.live.add(file);
      return new Proxy(file, {
        get(target, key) {
          if (key === 'read')
            return async (...values: Parameters<FileHandle['read']>) => {
              if (args[0] === io.path) {
                const hook = io.beforeRead;
                io.beforeRead = undefined;
                await hook?.();
              }
              return Reflect.apply(target.read, target, values);
            };
          if (key === 'close')
            return async () => {
              if (args[0] === io.path) {
                const hook = io.beforeClose;
                io.beforeClose = undefined;
                await hook?.();
              }
              await target.close();
              io.live.delete(target);
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  };
});
type ReadSelection = CrashSafeByteSlotReadSelection;
afterEach(() => {
  expect(io.live.size).toBe(0);
  for (const file of io.handles)
    expect(file.fd).toBe(-1);
  io.root = '';
  io.path = '';
  io.beforeRead = undefined;
  io.beforeClose = undefined;
  io.handles = [];
  io.live.clear();
  vi.restoreAllMocks();
});
it("journal intermediate: traces two driver reads and all seven native full guards", async (test) => {
  const f = await fixture(test);
  let intermediate = 0;
  const identity = await f.run(f.readSelection, {
    async assertAfterSlotRead() {
      intermediate++;
      f.events.push('intermediate');
      await f.assertRead();
    }
  });
  expect(intermediate).toBe(2);
  expect(f.calls.full).toBe(8);
  expect(f.calls.slots).toBe(33);
  expect(f.calls.mutations).toBe(7);
  expect(f.events.filter(value => value.startsWith('authorized:'))).toEqual([
    'authorized:prepareDirectory', 'authorized:createNextWriter', 'authorized:moveSlot',
    'authorized:moveSlot', 'authorized:syncDirectory', 'authorized:removeSlot', 'authorized:syncDirectory',
  ]);
  for (let index = 0; index < f.events.length; index++)
    if (f.events[index]!.startsWith('authorized:'))
      expect(f.events[index - 1]).toBe('full');
  expect(f.events.at(-1)).toBe('full');
  const selected = await f.store.inspect(f.assertAuthority);
  expect(selected.slots.current!.identity).toEqual(identity);
  expect(publishedPlan(selected.plan).selected.phase).toBe('quarantined');
  expect((await f.snapshot()).payload).toBe(Buffer.from('expected-payload').toString('hex'));
});
for (const point of [1, 4])
  for (const kind of ['payload', 'binding'] as const)
    for (const transient of [false, true]) {
      it(`journal intermediate: ${point} ${kind} ${transient ? 'transient' : 'persistent'} before native mutation`, async (test) => {
        const f = await fixture(test);
        let attacked = false, restored = false, mutations = -1;
        const read = f.fs.readSlot.bind(f.fs);
        f.fs.readSlot = async (...args) => {
          const value = await read(...args);
          if (!attacked && args[0] === 'backup' && f.prefixReads === point) {
            expect(io.live.size).toBe(0);
            expect((await readdir(f.paths.directoryPath)).sort()).toEqual((point === 1
              ? ['workspace-deletion-journal-v1.json']
              : ['workspace-deletion-journal-v1.json', 'workspace-deletion-journal-v1.json.next']).sort());
            attacked = true;
            mutations = f.calls.mutations;
            await writeFile(kind === 'payload' ? f.payloadPath : f.competitorPath, 'changed');
          }
          return value;
        };
        const work = f.run(f.readSelection, {
          async assertAfterSlotRead() {
            await f.assertRead();
            if (transient && attacked && !restored) {
              restored = true;
              if (kind === 'payload')
                await writeFile(f.payloadPath, 'expected-payload');
              else
                await rm(f.competitorPath);
            }
          }
        });
        if (transient)
          await work;
        else {
          const outward = await work.catch(error => error);
          expect(outward).toMatchObject({ name: 'CrashSafeFileSlotError', message: 'CRASH_SAFE_FILE_SLOT_UNAVAILABLE', failure: 'unavailable' });
          expect(() => f.assertAuthority()).toThrow(f.contentFailure);
          let retained: unknown;
          try {
            f.assertAuthority();
          }
          catch (error) {
            retained = error;
          }
          expect(retained).toBe(f.contentFailure);
          expect(f.calls.mutations).toBe(mutations);
        }
        expect(attacked).toBe(true);
        if (!transient) {
          expect(publishedPlan((await new WorkspaceDeletionJournalStore(f.root).inspect(() => undefined)).plan).selected.phase).toBe('authorized');
          if (point === 4)
            expect(await readFile(f.paths.nextPath)).toEqual(serializeWorkspaceDeletionJournal(journal('quarantined')));
          if (kind === 'payload')
            expect(await readFile(f.payloadPath, 'utf8')).toBe('changed');
          else
            expect(await readFile(f.competitorPath, 'utf8')).toBe('changed');
        }
      });
    }
for (const point of [1, 4])
  for (const kind of ['registry', 'writers', 'lease'] as const) {
    it(`journal intermediate: ${point} rejects immediate ${kind} loss`, async (test) => {
      const f = await fixture(test);
      let attacked = false, mutations = -1;
      const read = f.fs.readSlot.bind(f.fs);
      f.fs.readSlot = async (...args) => {
        const value = await read(...args);
        if (!attacked && args[0] === 'backup' && f.prefixReads === point) {
          expect(io.live.size).toBe(0);
          expect((await readdir(f.paths.directoryPath)).sort()).toEqual((point === 1
            ? ['workspace-deletion-journal-v1.json']
            : ['workspace-deletion-journal-v1.json', 'workspace-deletion-journal-v1.json.next']).sort());
          attacked = true;
          mutations = f.calls.mutations;
          if (kind === 'registry')
            await writeFile(f.registryPath, 'changed-registry');
          else if (kind === 'writers')
            f.returnWriter();
          else
            f.expire();
        }
        return value;
      };
      await expect(f.run(f.readSelection, { assertAfterSlotRead: f.assertRead })).rejects
        .toBe(kind === 'registry' ? f.registryFailure : kind === 'writers' ? f.writerFailure : f.leaseFailure);
      expect(f.calls.mutations).toBe(mutations);
      expect(attacked).toBe(true);
    });
  }
it("journal intermediate: fresh recovery keeps previous phase after prepared-next rejection", async (test) => {
  const f = await fixture(test);
  let attacked = false;
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => {
    const value = await read(...args);
    if (!attacked && args[0] === 'backup' && f.prefixReads === 4) {
      attacked = true;
      await writeFile(f.payloadPath, 'changed');
    }
    return value;
  };
  const outward = await f.run(f.readSelection, { assertAfterSlotRead: f.assertRead }).catch(error => error);
  expect(outward).toMatchObject({ name: 'CrashSafeFileSlotError', message: 'CRASH_SAFE_FILE_SLOT_UNAVAILABLE', failure: 'unavailable' });
  let retained: unknown;
  try {
    f.assertAuthority();
  }
  catch (error) {
    retained = error;
  }
  expect(retained).toBe(f.contentFailure);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(journal()));
  expect(await readFile(f.paths.nextPath)).toEqual(serializeWorkspaceDeletionJournal(journal('quarantined')));
  await writeFile(f.payloadPath, 'expected-payload');
  const fresh = new WorkspaceDeletionJournalStore(f.root);
  const selected = await fresh.inspect(() => undefined);
  let validations = 0;
  const identity = await fresh.recover({
    slots: selected.slots, assertAuthority: () => undefined,
    async assertExternalSelection() {
      validations++;
      expect(await readFile(f.payloadPath, 'utf8')).toBe('expected-payload');
      expect(await readFile(f.registryPath, 'utf8')).toBe('original-registry');
    }
  });
  expect(validations).toBeGreaterThan(0);
  expect(identity.ino).toBe(selected.slots.current!.identity!.ino);
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
  expect(publishedPlan((await fresh.inspect(() => undefined)).plan).selected.phase).toBe('authorized');
});
for (const stage of ['read', 'close'] as const) {
  it(`journal intermediate: settles owned ${stage} before rejecting revocation`, async (test) => {
    const f = await fixture(test), before = await f.snapshot();
    let release!: () => void, enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    f.releases.push(release);
    const hook = async () => { enter(); await held; };
    if (stage === 'read')
      io.beforeRead = hook;
    else
      io.beforeClose = hook;
    let settled = false;
    const work = f.run(f.readSelection, { assertAfterSlotRead: f.assertRead }).then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    try {
      await entered;
      f.expire();
      await setImmediate();
      expect(settled).toBe(false);
    }
    finally {
      release();
      await work;
    }
    expect(await work).toBe(f.leaseFailure);
    expect(await f.snapshot()).toEqual(before);
    expect(f.calls.mutations).toBe(0);
  });
}
it("journal intermediate: preserves writer and close aggregate without flattening", async (test) => {
  const f = await fixture(test), first = new Error('SYNTHETIC_INTERMEDIATE_WRITE'), later = new Error('SYNTHETIC_INTERMEDIATE_CLOSE');
  const create = f.fs.createNextWriter.bind(f.fs);
  f.fs.createNextWriter = async (guard) => {
    const writer = await create(guard);
    return {
      ...writer, readIdentity: () => writer.readIdentity!(), async write() { throw first; },
      async close() { await writer.close(); throw later; }
    };
  };
  const error = await f.run(f.readSelection, { assertAfterSlotRead: f.assertRead }).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([first, later]);
  expect((await f.snapshot())['workspace-deletion-journal-v1.json.next']).toBe('');
});
{
  for (const invalid of [null, {}, { assertAfterSlotRead: false }]) {
    it('journal intermediate: malformed context ' + JSON.stringify(invalid) + ' rejects before I/O', async (test) => {
      const f = await fixture(test), before = await f.snapshot();
      await expect(f.run(f.readSelection, invalid as unknown as {
        assertAfterSlotRead(): Promise<void>;
      })).rejects.toThrow();
      expect(f.calls.slots).toBe(0);
      expect(f.calls.mutations).toBe(0);
      expect(f.calls.full).toBe(0);
      expect(await f.snapshot()).toEqual(before);
    });
  }
  for (const first of [new Error('SYNTHETIC_INTERMEDIATE_FIRST'), undefined]) {
    it('journal intermediate: preserves ' + (first === undefined ? 'undefined' : 'Error') + ' exactly', async (test) => {
      const f = await fixture(test), before = await f.snapshot();
      let rejected = false, observed: unknown;
      await f.run(f.readSelection, { async assertAfterSlotRead() { throw first; } })
        .then(() => undefined, error => { rejected = true; observed = error; });
      expect(rejected).toBe(true);
      expect(observed).toBe(first);
      expect(f.calls.mutations).toBe(0);
      expect(await f.snapshot()).toEqual(before);
    });
  }
  it("journal intermediate: captures both callbacks before first await", async (test) => {
    const f = await fixture(test);
    let release!: () => void, enter!: () => void, first = true, replacements = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    f.releases.push(release);
    const prefix = {
      async assertBeforeSlotRead() {
        await f.assertRead(); if (first) {
          first = false;
          enter();
          await held;
        }
      }
    };
    const intermediate = { assertAfterSlotRead: f.assertRead };
    const work = f.run(prefix, intermediate);
    try {
      await entered;
      prefix.assertBeforeSlotRead = intermediate.assertAfterSlotRead = async () => { replacements++; throw new Error('REPLACED'); };
    }
    finally {
      release();
      await work;
    }
    expect(replacements).toBe(0);
  });
}
it("journal intermediate: final receipt rejects after last native sync", async (test) => {
  const f = await fixture(test);
  let synced = 0, attacked = false;
  const sync = f.fs.syncDirectory.bind(f.fs), read = f.fs.readSlot.bind(f.fs);
  f.fs.syncDirectory = async (guard) => { await sync(guard); synced++; };
  f.fs.readSlot = async (...args) => {
    const value = await read(...args);
    if (synced === 2 && !attacked && args[0] === 'backup') {
      attacked = true;
      await writeFile(f.payloadPath, 'returned-after-sync');
    }
    return value;
  };
  await expect(f.run(f.readSelection, { assertAfterSlotRead: f.assertRead })).rejects.toBe(f.contentFailure);
  expect(attacked).toBe(true);
  expect(f.calls.mutations).toBe(7);
  expect(await readFile(f.payloadPath, 'utf8')).toBe('returned-after-sync');
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(journal('quarantined')));
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
});
it("journal intermediate: native inner proof blocks changed binding before first move", async (test) => {
  const f = await fixture(test);
  let inside = false, attacked: Record<string, string> | undefined;
  const move = f.fs.moveSlot.bind(f.fs), read = f.fs.readSlot.bind(f.fs);
  f.fs.moveSlot = (source, destination, guard) => move(source, destination, {
    assertAuthority: guard!.assertAuthority,
    async beforeMutation() {
      inside = true; try {
        await guard!.beforeMutation();
      }
        finally {
        inside = false;
      }
    },
  });
  f.fs.readSlot = async (...args) => {
    const value = await read(...args);
    if (inside && !attacked && args[0] === 'backup') {
      await writeFile(f.competitorPath, 'late-binding');
      attacked = await f.snapshot();
    }
    return value;
  };
  await expect(f.run(f.readSelection, { assertAfterSlotRead: f.assertRead })).rejects.toMatchObject({
    name: 'CrashSafeFileSlotError', message: 'CRASH_SAFE_FILE_SLOT_UNAVAILABLE', failure: 'unavailable',
  });
  expect(attacked).toBeDefined();
  expect(await f.snapshot()).toEqual(attacked);
  expect(f.calls.mutations).toBe(2);
  let retained: unknown;
  try {
    f.assertAuthority();
  }
  catch (error) {
    retained = error;
  }
  expect(retained).toBe(f.contentFailure);
});
it("journal intermediate: changed current identity after intermediate read blocks native mutation", async (test) => {
  const f = await fixture(test);
  let attacked: Record<string, string> | undefined;
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => {
    const value = await read(...args);
    if (f.prefixReads === 1 && !attacked && args[0] === 'backup') {
      const bytes = await readFile(f.paths.currentPath);
      await rename(f.paths.currentPath, `${f.paths.currentPath}.retained`);
      await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
      attacked = await f.snapshot();
    }
    return value;
  };
  await expect(f.run(f.readSelection, { assertAfterSlotRead: f.assertRead })).rejects.toThrow();
  expect(attacked).toBeDefined();
  expect(await f.snapshot()).toEqual(attacked);
  expect(f.calls.mutations).toBe(0);
});
for (const cutAt of ['firstMove', 'secondMove', 'backupRemoval'] as const) {
  it(`journal intermediate: unchanged recovery after ${cutAt}`, async (test) => {
    const f = await fixture(test), cut = new Error('SYNTHETIC_INTERMEDIATE_CUT');
    const move = f.fs.moveSlot.bind(f.fs), remove = f.fs.removeSlot.bind(f.fs);
    let moves = 0;
    f.fs.moveSlot = async (...args) => {
      await move(...args);
      moves++;
      if ((cutAt === 'firstMove' && moves === 1) || (cutAt === 'secondMove' && moves === 2))
        throw cut;
    };
    f.fs.removeSlot = async (...args) => {
      const result = await remove(...args);
      if (cutAt === 'backupRemoval' && args[0] === 'backup')
        throw cut;
      return result;
    };
    await expect(f.run(f.readSelection, { assertAfterSlotRead: f.assertRead })).rejects.toBe(cut);
    const before = await f.snapshot();
    expect(before.payload).toBe(Buffer.from('expected-payload').toString('hex'));
    const fresh = new WorkspaceDeletionJournalStore(f.root), selected = await fresh.inspect(() => undefined);
    const previous = selected.slots.current ?? selected.slots.backup!;
    await fresh.recover({
      slots: selected.slots, assertAuthority: () => undefined, async assertExternalSelection() {
        expect(await readFile(f.payloadPath, 'utf8')).toBe('expected-payload');
        expect(await readFile(f.registryPath, 'utf8')).toBe('original-registry');
      }
    });
    expect((await f.snapshot()).payload).toBe(before.payload);
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
    const recovered = await fresh.inspect(() => undefined);
    expect(publishedPlan(recovered.plan).selected.phase).toBe(cutAt === 'firstMove' ? 'authorized' : 'quarantined');
    expect(recovered.slots.current!.identity!.ino).toBe(previous.identity!.ino);
  });
}
