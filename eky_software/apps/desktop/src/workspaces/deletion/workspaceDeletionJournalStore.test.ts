import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { deletionTestJournal as journal, deletionTestDigest as hash } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal,
  workspaceDeletionPhases } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore,
  type WorkspaceDeletionJournalSelection } from './workspaceDeletionJournalStore.js';
import { deletionTestOriginalJournalProof, deletionTestJournalV2 } from './workspaceDeletionOriginalJournalProofTestSupport.js';

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-deletion-store-'));
  await chmod(root, 0o700);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const paths = createWorkspaceDeletionJournalPaths(root);
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceDeletionJournalBytes);
  const store = new WorkspaceDeletionJournalStore(root, fs);
  let owned = true;
  let external = 'expected';
  const assertAuthority = () => { if (!owned) throw new Error('SYNTHETIC_LEASE_LOST'); };
  const assertExternalSelection = async () => { if (external !== 'expected') throw new Error('SYNTHETIC_TARGET_CHANGED'); };
  const select = async (): Promise<WorkspaceDeletionJournalSelection> => ({
    slots: (await store.inspect(assertAuthority)).slots, assertAuthority, assertExternalSelection,
  });
  return { root, paths, fs, store, select, assertAuthority,
    expire: () => { owned = false; }, changeTarget: () => { external = 'changed'; },
    async snapshot() {
      const values: Record<string, string> = {};
      try {
        for (const name of await readdir(paths.directoryPath)) {
          values[name] = (await readFile(join(paths.directoryPath, name))).toString('hex');
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return values;
    },
  };
}

it('observes only its default Node adapter, never a supplied filesystem', async context => {
  const f = await fixture(context), events: import('../persistence/crashSafeFileSlot.js').SlotIoEvent[] = [];
  const supplied = new WorkspaceDeletionJournalStore(f.root, f.fs, event => { events.push(event); });
  await supplied.publish(journal(), await f.select());
  expect((await supplied.inspect(f.assertAuthority)).plan.mode).toBe('published');
  expect(events).toEqual([]);
  const own = new WorkspaceDeletionJournalStore(f.root, undefined, event => { events.push(event); });
  expect((await own.inspect(f.assertAuthority)).plan.mode).toBe('published');
  expect(events.some(event => event.scope === 'ioAttempt' && event.operation === 'fileRead')).toBe(true);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(journal()));
});

it('preserves version-2 commitments through every real phase write and a fresh store', async context => {
  const f = await fixture(context), initial = deletionTestJournalV2();
  await f.store.publish(initial, await f.select());
  for (const phase of workspaceDeletionPhases.slice(1)) {
    const value = deletionTestJournalV2(phase);
    await f.store.advance(value, await f.select());
    expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.assertAuthority)).plan).toMatchObject({ mode: 'published', selected: value });
    expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(value));
  }
});

it('rejects changed version-2 commitments and version downgrade before writing', async context => {
  const f = await fixture(context), original = deletionTestOriginalJournalProof();
  await f.store.publish(deletionTestJournalV2(), await f.select());
  const before = await f.snapshot();
  const changed = { ...original, slots: { ...original.slots,
    current: { ...original.slots.current!, sha256: hash('changed original journal') } } };
  await expect(f.store.advance(deletionTestJournalV2('quarantined', [changed]), await f.select())).rejects.toThrow();
  await expect(f.store.advance(journal('quarantined'), await f.select())).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['initialNext', 'currentNext', 'backupNext', 'currentBackup'] as const)(
  'keeps version-2 proof across the actual %s slot interruption', async (state, context) => {
    const f = await fixture(context);
    await mkdir(f.paths.directoryPath, { mode: 0o700 });
    const initial = deletionTestJournalV2(), advanced = deletionTestJournalV2('quarantined');
    if (state === 'initialNext') await writeFile(f.paths.nextPath, serializeWorkspaceDeletionJournal(initial), { flag: 'wx', mode: 0o600 });
    else {
      await writeFile(state === 'backupNext' ? f.paths.backupPath : f.paths.currentPath,
        serializeWorkspaceDeletionJournal(state === 'currentBackup' ? advanced : initial), { flag: 'wx', mode: 0o600 });
      await writeFile(state === 'currentBackup' ? f.paths.backupPath : f.paths.nextPath,
        serializeWorkspaceDeletionJournal(state === 'currentBackup' ? initial : advanced), { flag: 'wx', mode: 0o600 });
    }
    if (state === 'initialNext') {
      const before = await f.snapshot();
      expect((await f.store.inspect(f.assertAuthority)).plan.mode).toBe('unpublished');
      await expect(f.store.recover(await f.select())).rejects.toThrow();
      expect(await f.snapshot()).toEqual(before);
    } else {
      await f.store.recover(await f.select());
      expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.assertAuthority)).plan).toMatchObject({
        mode: 'published', selected: state === 'currentBackup' ? advanced : initial,
      });
      expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
    }
  },
);

it('rejects mixed version-1 and version-2 native slots without recovery or conversion', async context => {
  const f = await fixture(context);
  await mkdir(f.paths.directoryPath, { mode: 0o700 });
  await writeFile(f.paths.currentPath, serializeWorkspaceDeletionJournal(journal()), { flag: 'wx', mode: 0o600 });
  await writeFile(f.paths.nextPath, serializeWorkspaceDeletionJournal(deletionTestJournalV2('quarantined')), { flag: 'wx', mode: 0o600 });
  const before = await f.snapshot();
  await expect(f.store.inspect(f.assertAuthority)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await f.snapshot()).toEqual(before);
});

it('publishes, advances and retires actual slots with live external guards', async context => {
  const f = await fixture(context);
  const first = await f.store.publish(journal(), await f.select());
  expect(first.ino).not.toBe(0);
  for (const phase of workspaceDeletionPhases.slice(1)) {
    await f.store.advance(journal(phase), await f.select());
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
    expect((await f.store.inspect(f.assertAuthority)).plan).toMatchObject({ mode: 'published', selected: journal(phase) });
  }
  let absenceChecks = 0;
  await f.store.clearTerminal(await f.select(), { async assertInventoryAndOperationRootAbsent() { absenceChecks++; } });
  expect(absenceChecks).toBeGreaterThan(0);
  expect((await f.store.inspect(f.assertAuthority)).plan.mode).toBe('absent');
});

it('refuses phase skips, changed bindings, duplicate publication and early clear without changing bytes', async context => {
  const f = await fixture(context);
  await expect(f.store.publish(journal('quarantined'), await f.select())).rejects.toThrow();
  await f.store.publish(journal(), await f.select());
  const before = await f.snapshot();
  await expect(f.store.publish(journal(), await f.select())).rejects.toThrow();
  await expect(f.store.advance(journal('purgeAuthorized'), await f.select())).rejects.toThrow();
  await expect(f.store.advance(captureWorkspaceDeletionJournal({ ...journal('quarantined'),
    inventoryFileIdentity: hash('different') }), await f.select())).rejects.toThrow();
  await expect(f.store.clearTerminal(await f.select(), { async assertInventoryAndOperationRootAbsent() {} })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('checks the complete publication once after closing next and before publishing current', async context => {
  const f = await fixture(context);
  let comparisons = 0, externalChecks = 0;
  const selected = await f.select();
  await f.store.publish(journal(), { ...selected, async assertExternalSelection() {
    externalChecks++; await selected.assertExternalSelection();
  } }, async () => {
    comparisons++;
    expect(await readFile(f.paths.nextPath)).toEqual(serializeWorkspaceDeletionJournal(journal()));
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
  });
  expect(comparisons).toBe(1);
  expect(externalChecks).toBeGreaterThan(1);
  expect((await f.store.inspect(f.assertAuthority)).plan.mode).toBe('published');
});

it('preserves the original final comparison failure and does not promote initial next', async context => {
  const f = await fixture(context), first = new Error('SYNTHETIC_FINAL_CONTENT_CHANGED');
  await expect(f.store.publish(journal(), await f.select(), async () => { throw first; })).rejects.toBe(first);
  expect(await readFile(f.paths.nextPath)).toEqual(serializeWorkspaceDeletionJournal(journal()));
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
  expect((await new WorkspaceDeletionJournalStore(f.root).inspect(() => {})).plan.mode).not.toBe('published');
});

it.for(['lease', 'target', 'current', 'backup', 'next'] as const)(
  'rechecks %s after the final long comparison before publication', async (changed, context) => {
    const f = await fixture(context);
    let afterChange!: Record<string, string>;
    await expect(f.store.publish(journal(), await f.select(), async () => {
      if (changed === 'lease') f.expire();
      else if (changed === 'target') f.changeTarget();
      else {
        const path = changed === 'current' ? f.paths.currentPath : changed === 'backup' ? f.paths.backupPath : f.paths.nextPath;
        if (changed === 'next') await rm(path);
        await writeFile(path, serializeWorkspaceDeletionJournal(journal()), { flag: 'wx', mode: 0o600 });
      }
      afterChange = await f.snapshot();
    })).rejects.toThrow();
    expect(await f.snapshot()).toEqual(afterChange);
    expect(await readFile(f.paths.nextPath)).toEqual(serializeWorkspaceDeletionJournal(journal()));
  },
);

it('joins a pending final comparison after authority loss without promoting next', async context => {
  const f = await fixture(context);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let settled = false;
  const work = f.store.publish(journal(), await f.select(), async () => { entered(); await held; })
    .then(() => { settled = true; return undefined; }, error => { settled = true; return error as unknown; });
  context.onTestFinished(async () => { release(); await work; });
  await started;
  f.expire();
  expect(settled).toBe(false);
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
  release();
  expect(await work).toBeInstanceOf(Error);
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
});

it('does not run the expensive callback for an inadmissible or already published journal', async context => {
  const f = await fixture(context);
  let called = false;
  const compare = async () => { called = true; };
  await expect(f.store.publish(journal('quarantined'), await f.select(), compare)).rejects.toThrow();
  await f.store.publish(journal(), await f.select());
  await expect(f.store.publish(journal(), await f.select(), compare)).rejects.toThrow();
  expect(called).toBe(false);
});

it('does not promote initial-next and preserves it for explicit resolution', async context => {
  const f = await fixture(context);
  await mkdir(f.paths.directoryPath, { mode: 0o700 });
  await writeFile(f.paths.nextPath, serializeWorkspaceDeletionJournal(journal()), { flag: 'wx', mode: 0o600 });
  const before = await f.snapshot();
  const selection = await f.select();
  await expect(f.store.recover(selection)).rejects.toThrow();
  await expect(f.store.publish(journal(), selection)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

for (const state of ['currentNext', 'backupNext', 'currentBackup'] as const) {
  it(`recovers only the previously published state for ${state}`, async context => {
    const f = await fixture(context);
    await mkdir(f.paths.directoryPath, { mode: 0o700 });
    const current = state === 'currentBackup' ? journal('quarantined') : journal();
    const selected = state === 'backupNext' ? f.paths.backupPath : f.paths.currentPath;
    await writeFile(selected, serializeWorkspaceDeletionJournal(current), { flag: 'wx', mode: 0o600 });
    await writeFile(state === 'currentBackup' ? f.paths.backupPath : f.paths.nextPath,
      serializeWorkspaceDeletionJournal(state === 'currentBackup' ? journal() : journal('quarantined')),
      { flag: 'wx', mode: 0o600 });
    await f.store.recover(await f.select());
    expect((await f.store.inspect(f.assertAuthority)).plan).toMatchObject({ mode: 'published', selected: current });
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
  });
}

for (const fault of ['beforeWrite', 'afterWrite', 'sync', 'close', 'beforePublish', 'afterPublish', 'directorySync'] as const) {
  it(`retains actual partial publication evidence for ${fault}`, async context => {
    const f = await fixture(context);
    const first = new Error(`SYNTHETIC_${fault}`);
    let writerClosed = false;
    const open = f.fs.createNextWriter.bind(f.fs);
    f.fs.createNextWriter = async guard => {
      const writer = await open(guard);
      return { ...writer, readIdentity: () => writer.readIdentity!(),
        async write(bytes) {
          if (fault === 'beforeWrite') throw first;
          const count = await writer.write(bytes);
          if (fault === 'afterWrite') throw first;
          return count;
        },
        async sync() { await writer.sync(); if (fault === 'sync') throw first; },
        async close() { await writer.close(); writerClosed = true; if (fault === 'close') throw first; },
      };
    };
    const move = f.fs.moveSlot.bind(f.fs);
    f.fs.moveSlot = async (...args) => {
      if (fault === 'beforePublish') throw first;
      await move(...args);
      if (fault === 'afterPublish') throw first;
    };
    const sync = f.fs.syncDirectory.bind(f.fs);
    f.fs.syncDirectory = async (...args) => { await sync(...args); if (fault === 'directorySync') throw first; };
    await expect(f.store.publish(journal(), await f.select())).rejects.toBe(first);
    expect(writerClosed).toBe(true);
    const names = await readdir(f.paths.directoryPath);
    expect(names).toHaveLength(1);
    if (fault === 'afterPublish' || fault === 'directorySync') {
      expect(names).toEqual(['workspace-deletion-journal-v1.json']);
      const restarted = new WorkspaceDeletionJournalStore(f.root);
      expect((await restarted.inspect(f.assertAuthority)).plan).toMatchObject({ mode: 'published', selected: journal() });
    } else expect(names).toEqual(['workspace-deletion-journal-v1.json.next']);
  });
}

it('joins writer close and preserves both the original write failure and later close failure', async context => {
  const f = await fixture(context);
  const first = new Error('SYNTHETIC_WRITE');
  const later = new Error('SYNTHETIC_CLOSE');
  const open = f.fs.createNextWriter.bind(f.fs);
  f.fs.createNextWriter = async guard => {
    const writer = await open(guard);
    return { async write() { throw first; }, sync: () => writer.sync(),
      async close() { await writer.close(); throw later; } };
  };
  await expect(f.store.publish(journal(), await f.select())).rejects.toMatchObject({ errors: [first, later] });
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
});

it('rejects stale bytes, replaced identity and external target/lease loss before mutation', async context => {
  const f = await fixture(context);
  await f.store.publish(journal(), await f.select());
  const selected = await f.select();
  const before = await f.snapshot();
  const current = selected.slots.current!;
  const changedIdentity = { ...current.identity!, dev: current.identity!.dev === 0 ? 1 : 0 };
  expect(changedIdentity.dev).not.toBe(current.identity!.dev);
  await expect(f.store.advance(journal('quarantined'), { ...selected, slots: { ...selected.slots,
    current: { ...current, identity: changedIdentity } } })).rejects.toThrow();
  f.changeTarget();
  await expect(f.store.advance(journal('quarantined'), selected)).rejects.toThrow('SYNTHETIC_TARGET_CHANGED');
  f.expire();
  await expect(f.store.advance(journal('quarantined'), selected)).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect(await f.snapshot()).toEqual(before);
});

it('refuses terminal clear while inventory absence is unproven', async context => {
  const f = await fixture(context);
  await f.store.publish(journal(), await f.select());
  for (const phase of workspaceDeletionPhases.slice(1)) await f.store.advance(journal(phase), await f.select());
  const before = await f.snapshot();
  const first = new Error('SYNTHETIC_INVENTORY_REMAINS');
  await expect(f.store.clearTerminal(await f.select(), { async assertInventoryAndOperationRootAbsent() { throw first; } })).rejects.toBe(first);
  expect(await f.snapshot()).toEqual(before);
});

for (const changed of ['absence', 'registry'] as const) {
  it(`preserves terminal journal when ${changed} changes after the first absence check`, async context => {
    const f = await fixture(context);
    await f.store.publish(journal(), await f.select());
    for (const phase of workspaceDeletionPhases.slice(1)) await f.store.advance(journal(phase), await f.select());
    const selected = await f.select();
    const before = await f.snapshot();
    const first = new Error('SYNTHETIC_ABSENCE_BECAME_STALE');
    let absent = true;
    let absenceChecks = 0;
    const read = f.fs.readSlot.bind(f.fs);
    f.fs.readSlot = async (...args) => {
      const result = await read(...args);
      if (args[0] === 'next' && absenceChecks > 0) {
        absent = false;
        if (changed === 'registry') f.changeTarget();
      }
      return result;
    };
    const clear = f.store.clearTerminal(selected, { async assertInventoryAndOperationRootAbsent() {
      absenceChecks++;
      if (!absent) throw first;
    } });
    if (changed === 'absence') await expect(clear).rejects.toBe(first);
    else await expect(clear).rejects.toThrow('SYNTHETIC_TARGET_CHANGED');
    expect(absenceChecks).toBeGreaterThan(changed === 'absence' ? 1 : 0);
    expect(await f.snapshot()).toEqual(before);
  });
}

it.for([false, true])('terminal prefix keeps native read/full-absence/read guards (option: %s)', async (option, context) => {
  const f = await fixture(context);
  await mkdir(f.paths.directoryPath, { mode: 0o700 });
  await writeFile(f.paths.currentPath, serializeWorkspaceDeletionJournal(journal('registryPublished')), { flag: 'wx', mode: 0o600 });
  const selected = await f.select(), events: string[] = [];
  const read = f.fs.readSlot.bind(f.fs), remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
  f.fs.readSlot = async (...args) => { events.push('read.' + args[0]); return read(...args); };
  f.fs.removeSlot = async (...args) => { events.push('remove.start'); const value = await remove(...args); events.push('remove.end'); return value; };
  f.fs.syncDirectory = async (...args) => { events.push('sync.start'); await sync(...args); events.push('sync.end'); };
  const external = { ...selected, async assertExternalSelection() { events.push('full'); await selected.assertExternalSelection(); } };
  const absent = { async assertInventoryAndOperationRootAbsent() { events.push('absent'); } };
  if (option)
    await f.store.clearTerminal(external, absent, { async assertBeforeSlotRead() { events.push('prefix'); } });
  else
    await f.store.clearTerminal(external, absent);
  const full = ['full', 'absent', 'full'];
  const round = [...(option ? ['prefix'] : full), 'read.current', 'read.next', 'read.backup', ...full];
  expect(events).toEqual([...round, 'remove.start', ...round, 'remove.end', 'sync.start', ...round, 'sync.end', ...round]);
  expect(await f.snapshot()).toEqual({});
});
it.for(['first', 'nativeRemove', 'nativeSync'] as const)('terminal prefix retains the full guard at %s', async (boundary, context) => {
  const f = await fixture(context), first = new Error('SYNTHETIC_TERMINAL_FULL_PROOF_LOST');
  await mkdir(f.paths.directoryPath, { mode: 0o700 });
  const bytes = serializeWorkspaceDeletionJournal(journal('registryPublished'));
  await writeFile(f.paths.currentPath, bytes, { flag: 'wx', mode: 0o600 });
  const selected = await f.select();
  let armed = boundary === 'first', removes = 0, syncs = 0;
  const remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
  f.fs.removeSlot = async (...args) => { removes++; if (boundary === 'nativeRemove')
    armed = true; return remove(...args); };
  f.fs.syncDirectory = async (...args) => { syncs++; if (boundary === 'nativeSync')
    armed = true; return sync(...args); };
  const outcome = await f.store.clearTerminal({ ...selected, async assertExternalSelection() {
      if (armed)
        throw first;
      await selected.assertExternalSelection();
    } }, { async assertInventoryAndOperationRootAbsent() { } }, { async assertBeforeSlotRead() { f.assertAuthority(); } })
    .then(() => ({ ok: true }), (error: unknown) => ({ error }));
  expect('error' in outcome).toBe(true);
  if (boundary === 'nativeRemove')
    expect((outcome as {
      error: unknown;
    }).error).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
  else
    expect((outcome as {
      error: unknown;
    }).error).toBe(first);
  expect(removes).toBe(boundary === 'first' ? 0 : 1);
  expect(syncs).toBe(boundary === 'nativeSync' ? 1 : 0);
  if (boundary === 'nativeSync')
    await expect(readFile(f.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  else
    expect(await readFile(f.paths.currentPath)).toEqual(bytes);
});
it('terminal prefix cannot authorize changed selected slot bytes', async (context) => {
  const f = await fixture(context);
  await mkdir(f.paths.directoryPath, { mode: 0o700 });
  await writeFile(f.paths.currentPath, serializeWorkspaceDeletionJournal(journal('registryPublished')), { flag: 'wx', mode: 0o600 });
  const selected = await f.select(), unexpected = Buffer.from('unexpected independent bytes');
  await writeFile(f.paths.nextPath, unexpected, { flag: 'wx', mode: 0o600 });
  const before = await f.snapshot();
  let removes = 0;
  const remove = f.fs.removeSlot.bind(f.fs);
  f.fs.removeSlot = async (...args) => { removes++; return remove(...args); };
  await expect(f.store.clearTerminal(selected, { async assertInventoryAndOperationRootAbsent() { } }, { async assertBeforeSlotRead() { f.assertAuthority(); } })).rejects.toThrow();
  expect(removes).toBe(0);
  expect(await f.snapshot()).toEqual(before);
});

type InitialPublicationReadPort = import('../persistence/crashSafeByteSlotStore.js').CrashSafeByteSlotReadSelection;
type InitialPublicationFixture = Awaited<ReturnType<typeof fixture>>;
type InitialPublicationIdentity = Awaited<ReturnType<WorkspaceDeletionJournalStore['publish']>>;
type InitialPublicationNativeBoundary = 'prepare' | 'create' | 'move' | 'sync';
function initialPublicationPublish(f: InitialPublicationFixture, selection: WorkspaceDeletionJournalSelection, compare?: () => Promise<void>, readSelection?: InitialPublicationReadPort) {
  return f.store.publish(journal(), selection, compare, readSelection);
}
function initialPublicationProbe(f: InitialPublicationFixture, beforeNative?: (boundary: InitialPublicationNativeBoundary) => Promise<void>) {
  const events: string[] = [], completed: InitialPublicationNativeBoundary[] = [];
  let writerClosed = false, createdIdentity: InitialPublicationIdentity | undefined;
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => { events.push(`slot:${args[0]}`); return read(...args); };
  const prepare = f.fs.prepareDirectory.bind(f.fs);
  f.fs.prepareDirectory = async (guard) => {
    events.push('prepare:begin');
    await beforeNative?.('prepare');
    await prepare(guard);
    completed.push('prepare');
    events.push('prepare:end');
  };
  const create = f.fs.createNextWriter.bind(f.fs);
  f.fs.createNextWriter = async (guard) => {
    events.push('create:begin');
    await beforeNative?.('create');
    const writer = await create(guard);
    completed.push('create');
    events.push('create:end');
    return {
      write: (bytes: Uint8Array) => writer.write(bytes), sync: () => writer.sync(),
      async readIdentity() {
        if (writer.readIdentity === undefined)
          throw new Error('SYNTHETIC_EXPECTED_WRITER_IDENTITY');
        createdIdentity = await writer.readIdentity();
        return createdIdentity;
      },
      async close() { await writer.close(); writerClosed = true; events.push('writer:closed'); },
    };
  };
  const move = f.fs.moveSlot.bind(f.fs);
  f.fs.moveSlot = async (...args) => {
    events.push('move:begin');
    await beforeNative?.('move');
    await move(...args);
    completed.push('move');
    events.push('move:end');
  };
  const sync = f.fs.syncDirectory.bind(f.fs);
  f.fs.syncDirectory = async (guard) => {
    events.push('sync:begin');
    await beforeNative?.('sync');
    await sync(guard);
    completed.push('sync');
    events.push('sync:end');
  };
  const remove = f.fs.removeSlot.bind(f.fs);
  f.fs.removeSlot = async (...args) => { events.push('remove:unexpected'); return remove(...args); };
  return { events, completed, get writerClosed() { return writerClosed; },
    get createdIdentity() { return createdIdentity; } };
}
function initialPublicationExpectedTrace(useReadPort: boolean) {
  const round = [useReadPort ? 'readcheck' : 'fullcheck',
    'slot:current', 'slot:next', 'slot:backup', 'fullcheck'];
  return [
    ...round,
    'prepare:begin', ...round, 'prepare:end',
    'create:begin', ...round, 'create:end', 'writer:closed', 'slot:next',
    ...round,
    ...round, 'publication', ...round,
    'move:begin', ...round, 'move:end', 'slot:current',
    'sync:begin', ...round, 'sync:end', ...round,
  ];
}
async function initialPublicationOutcome<T>(work: Promise<T>) {
  return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
it('initial publication publishes exact bytes and tracked identity with no sibling slots', async (context) => {
  const f = await fixture(context), selected = await f.select(), probe = initialPublicationProbe(f);
  let comparisons = 0, prefixes = 0;
  const identity = await initialPublicationPublish(f, selected, async () => {
    comparisons++;
    expect(probe.writerClosed).toBe(true);
    expect((await readFile(f.paths.nextPath)).equals(serializeWorkspaceDeletionJournal(journal()))).toBe(true);
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
  }, { async assertBeforeSlotRead() { prefixes++; f.assertAuthority(); } });
  expect(comparisons).toBe(1);
  expect(prefixes).toBe(9);
  expect(identity.ino).not.toBe(0);
  expect(identity.ino).toBe(probe.createdIdentity?.ino);
  expect(identity.dev).toBe(probe.createdIdentity?.dev);
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceDeletionJournal(journal()))).toBe(true);
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
  const observed = await new WorkspaceDeletionJournalStore(f.root).inspect(f.assertAuthority);
  expect(observed.slots.current?.identity).toEqual(identity);
  expect(observed.slots.next).toBeUndefined();
  expect(observed.slots.backup).toBeUndefined();
  expect(observed.plan).toMatchObject({ mode: 'published', selected: journal() });
});
it('initial publication keeps the portless path and both full checks unchanged', async (context) => {
  const f = await fixture(context), selected = await f.select(), probe = initialPublicationProbe(f);
  await initialPublicationPublish(f, { ...selected, async assertExternalSelection() {
      probe.events.push('fullcheck');
      await selected.assertExternalSelection();
    } }, async () => { probe.events.push('publication'); });
  expect(probe.events).toEqual(initialPublicationExpectedTrace(false));
  expect(probe.completed).toEqual(['prepare', 'create', 'move', 'sync']);
});
it('initial publication orders leading readcheck and last fullcheck in intermediate and mutation rounds', async (context) => {
  const f = await fixture(context), selected = await f.select(), probe = initialPublicationProbe(f);
  await initialPublicationPublish(f, { ...selected, async assertExternalSelection() {
      probe.events.push('fullcheck');
      await selected.assertExternalSelection();
    } }, async () => { probe.events.push('publication'); }, {
    async assertBeforeSlotRead() { probe.events.push('readcheck'); f.assertAuthority(); },
  });
  // The first round and the round after writer close are intermediate reads.
  // Native prepare/create/move/sync, both publication guards and final are strict.
  expect(probe.events).toEqual(initialPublicationExpectedTrace(true));
  expect(probe.events.at(-1)).toBe('fullcheck');
});
it.for(['prepare', 'create', 'move', 'sync'] as const)('initial publication persistent external change blocks the next native %s', async (boundary, context) => {
  const f = await fixture(context), selected = await f.select();
  let changed = false, afterChange: Record<string, string> | undefined;
  const probe = initialPublicationProbe(f, async (current) => {
    if (current !== boundary)
      return;
    changed = true;
    f.changeTarget();
    afterChange = await f.snapshot();
  });
  const outcome = await initialPublicationOutcome(initialPublicationPublish(f, selected, async () => { }, {
    async assertBeforeSlotRead() { f.assertAuthority(); },
  }));
  expect(changed).toBe(true);
  expect(outcome.ok).toBe(false);
  if (outcome.ok)
    throw new Error('SYNTHETIC_EXPECTED_PUBLICATION_REJECTION');
  // syncDirectory's guard is outside its native error-mapping try block.
  if (boundary === 'sync')
    expect(outcome.error).toMatchObject({ message: 'SYNTHETIC_TARGET_CHANGED' });
  else
    expect(outcome.error).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
  const preceding = { prepare: [], create: ['prepare'], move: ['prepare', 'create'],
    sync: ['prepare', 'create', 'move'] };
  expect(probe.completed).toEqual(preceding[boundary]);
  expect(afterChange).toBeDefined();
  expect(await f.snapshot()).toEqual(afterChange);
  if (boundary === 'sync')
    expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceDeletionJournal(journal()))).toBe(true);
});
it.for(['intermediate', 'mutation'] as const)('initial publication admits only the omitted leading %s transient window', async (boundary, context) => {
  const f = await fixture(context), selected = await f.select();
  const proofPath = join(f.root, 'initial-publication-external-proof');
  await writeFile(proofPath, 'expected', { flag: 'wx', mode: 0o600 });
  const first = new Error('SYNTHETIC_TRANSIENT_EXTERNAL_CHANGE');
  let armed = false, restored = false, fullFailure = false;
  const arm = async () => { armed = true; await writeFile(proofPath, 'changed'); };
  const probe = initialPublicationProbe(f, async (current) => {
    if (boundary === 'mutation' && current === 'prepare')
      await arm();
  });
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => {
    // Restore before the first slot I/O, never after the trailing full check.
    if (armed && !restored && args[0] === 'current') {
      await writeFile(proofPath, 'expected');
      restored = true;
    }
    return read(...args);
  };
  if (boundary === 'intermediate')
    await arm();
  const outcome = await initialPublicationOutcome(initialPublicationPublish(f, {
    ...selected, async assertExternalSelection() {
      if (await readFile(proofPath, 'utf8') !== 'expected') {
        fullFailure = true;
        throw first;
      }
      await selected.assertExternalSelection();
    },
  }, async () => { }, { async assertBeforeSlotRead() { f.assertAuthority(); } }));
  expect(armed).toBe(true);
  expect(outcome.ok).toBe(true);
  expect(restored).toBe(true);
  expect(fullFailure).toBe(false);
  if (outcome.ok) {
    expect(probe.completed).toEqual(['prepare', 'create', 'move', 'sync']);
    expect(await readFile(proofPath, 'utf8')).toBe('expected');
    expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceDeletionJournal(journal()))).toBe(true);
  }
  else {
    if (boundary === 'intermediate')
      expect(outcome.error).toBe(first);
    else
      expect(outcome.error).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
    expect(probe.completed).toEqual([]);
    expect(await f.snapshot()).toEqual({});
    expect(await readFile(proofPath, 'utf8')).toBe('changed');
  }
});
it.for(['current', 'next', 'backup'] as const)('initial publication rejects changed %s bytes or an independent same-byte file (current and backup prove absence)', async (slot, context) => {
  for (const kind of ['bytes', 'sameBytesNewFile'] as const) {
    const f = await fixture(context), selected = await f.select(), probe = initialPublicationProbe(f);
    const { rename } = await import('node:fs/promises');
    let changed: Record<string, string> | undefined, checked = false;
    const outcome = await initialPublicationOutcome(initialPublicationPublish(f, selected, async () => {
      checked = true;
      const bytes = serializeWorkspaceDeletionJournal(journal());
      const path = slot === 'current' ? f.paths.currentPath : slot === 'next' ? f.paths.nextPath : f.paths.backupPath;
      const changedBytes = Buffer.from(bytes);
      changedBytes[changedBytes.length - 1] = changedBytes[changedBytes.length - 1]! ^ 1;
      if (slot === 'next') {
        if (kind === 'sameBytesNewFile') {
          // Keep the old inode alive; no hardlink, deletion or inode-reuse race.
          await rename(path, join(f.root, 'retained-initial-publication-next'));
          await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
          let identity: InitialPublicationIdentity | undefined;
          const actual = await f.fs.readSlot('next', value => { identity = value; });
          expect(Buffer.from(actual!).equals(bytes)).toBe(true);
          expect(identity).toBeDefined();
          expect(probe.createdIdentity).toBeDefined();
          expect(identity!.dev === probe.createdIdentity!.dev && identity!.ino === probe.createdIdentity!.ino).toBe(false);
        }
        else
          await writeFile(path, changedBytes);
      }
      else {
        // current/backup were selected absent: this proves absence, not a
        // comparison with an identity that never existed in this publication.
        await writeFile(path, kind === 'bytes' ? changedBytes : bytes, { flag: 'wx', mode: 0o600 });
      }
      changed = await f.snapshot();
    }, { async assertBeforeSlotRead() { f.assertAuthority(); } }));
    expect(checked).toBe(true);
    expect(outcome.ok).toBe(false);
    if (outcome.ok)
      throw new Error('SYNTHETIC_EXPECTED_SLOT_REJECTION');
    expect(outcome.error).toBeInstanceOf(Error);
    expect(changed).toBeDefined();
    expect(await f.snapshot()).toEqual(changed);
    expect(probe.completed).toEqual(['prepare', 'create']);
    if (slot === 'next' && kind === 'sameBytesNewFile')
      expect((await readFile(join(f.root, 'retained-initial-publication-next'))).equals(serializeWorkspaceDeletionJournal(journal()))).toBe(true);
  }
});
it('initial publication retains strict authority and external guards after the publication callback', async (context) => {
  for (const loss of ['authority', 'external'] as const) {
    const f = await fixture(context), selected = await f.select(), probe = initialPublicationProbe(f);
    let comparisons = 0, afterChange: Record<string, string> | undefined;
    const outcome = await initialPublicationOutcome(initialPublicationPublish(f, selected, async () => {
      comparisons++;
      if (loss === 'authority')
        f.expire();
      else
        f.changeTarget();
      afterChange = await f.snapshot();
    }, { async assertBeforeSlotRead() { f.assertAuthority(); } }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok)
      throw new Error('SYNTHETIC_EXPECTED_POST_CALLBACK_REJECTION');
    expect(outcome.error).toMatchObject({ message: loss === 'authority' ? 'SYNTHETIC_LEASE_LOST' : 'SYNTHETIC_TARGET_CHANGED' });
    expect(comparisons).toBe(1);
    expect(probe.writerClosed).toBe(true);
    expect(probe.completed).toEqual(['prepare', 'create']);
    expect(afterChange).toBeDefined();
    expect(await f.snapshot()).toEqual(afterChange);
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
  }
});
it('initial publication cannot replace the final full check with readport success', async (context) => {
  const f = await fixture(context), selected = await f.select();
  let afterSync: Record<string, string> | undefined, prefixes = 0;
  const probe = initialPublicationProbe(f), sync = f.fs.syncDirectory.bind(f.fs);
  f.fs.syncDirectory = async (guard) => {
    await sync(guard);
    f.changeTarget();
    afterSync = await f.snapshot();
  };
  const outcome = await initialPublicationOutcome(initialPublicationPublish(f, selected, async () => { }, {
    async assertBeforeSlotRead() { prefixes++; f.assertAuthority(); },
  }));
  expect(outcome.ok).toBe(false);
  if (outcome.ok)
    throw new Error('SYNTHETIC_EXPECTED_FINAL_REJECTION');
  expect(outcome.error).toMatchObject({ message: 'SYNTHETIC_TARGET_CHANGED' });
  expect(prefixes).toBe(9);
  expect(probe.completed).toEqual(['prepare', 'create', 'move', 'sync']);
  expect(afterSync).toBeDefined();
  expect(await f.snapshot()).toEqual(afterSync);
  // Publication already happened: rejection is not a claim of rollback.
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceDeletionJournal(journal()))).toBe(true);
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json']);
});
it.for(['read', 'close'] as const)('initial publication joins a held real next handle at %s after authority loss', async (stage, context) => {
  const f = await fixture(context), selected = await f.select(), probe = initialPublicationProbe(f);
  const { open } = await import('node:fs/promises');
  const { setImmediate } = await import('node:timers/promises');
  let release!: () => void, enter!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let handle: import('node:fs/promises').FileHandle | undefined;
  let intercepted = false, closed = false, settled = false;
  const bytes = serializeWorkspaceDeletionJournal(journal()), read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => {
    if (args[0] !== 'next' || !probe.writerClosed || intercepted)
      return read(...args);
    intercepted = true;
    handle = await open(f.paths.nextPath, 'r');
    // A narrow adapter wrapper owns a real read/close, then delegates the
    // normal validated slot read. No claim of a suspended kernel syscall.
    try {
      if (stage === 'read') {
        enter();
        await held;
      }
      const actual = Buffer.alloc(bytes.length);
      expect((await handle.read(actual, 0, actual.length, 0)).bytesRead).toBe(bytes.length);
      expect(actual.equals(bytes)).toBe(true);
      if (stage === 'close') {
        enter();
        await held;
      }
    }
    finally {
      await handle.close();
      closed = true;
    }
    return read(...args);
  };
  const work = initialPublicationOutcome(initialPublicationPublish(f, selected, async () => { }, {
    async assertBeforeSlotRead() { f.assertAuthority(); },
  })).then(outcome => { settled = true; return outcome; });
  const abort = () => { f.expire(); release(); };
  context.signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_EXPECTED_HELD_HANDLE'); })]);
    expect(handle?.fd).not.toBe(-1);
    expect(closed).toBe(false);
    f.expire();
    await setImmediate();
    expect(settled).toBe(false);
    expect(probe.completed).toEqual(['prepare', 'create']);
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
  }
  finally {
    release();
    await work;
    context.signal.removeEventListener('abort', abort);
  }
  const outcome = await work;
  expect(outcome.ok).toBe(false);
  if (outcome.ok)
    throw new Error('SYNTHETIC_EXPECTED_REVOKED_READ_REJECTION');
  expect(outcome.error).toMatchObject({ message: 'SYNTHETIC_LEASE_LOST' });
  expect(intercepted).toBe(true);
  expect(closed).toBe(true);
  expect(handle?.fd).toBe(-1);
  expect(probe.completed).toEqual(['prepare', 'create']);
  expect((await readFile(f.paths.nextPath)).equals(bytes)).toBe(true);
  expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
});
it('initial publication joins writer close and preserves original Error or undefined plus close failure', async (context) => {
  for (const first of [new Error('SYNTHETIC_INITIAL_WRITE_FAILURE'), undefined]) {
    const f = await fixture(context), selected = await f.select();
    const later = new Error('SYNTHETIC_INITIAL_CLOSE_FAILURE');
    let release!: () => void, enter!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const create = f.fs.createNextWriter.bind(f.fs);
    let closed = false, settled = false;
    f.fs.createNextWriter = async (guard) => {
      const writer = await create(guard);
      return {
        async write(): Promise<number> { throw first; }, sync: () => writer.sync(),
        async close() {
          try {
            enter();
            await held;
          }
          finally {
            await writer.close();
            closed = true;
          }
          throw later;
        },
      };
    };
    const work = initialPublicationOutcome(initialPublicationPublish(f, selected, async () => { }, {
      async assertBeforeSlotRead() { f.assertAuthority(); },
    })).then(outcome => { settled = true; return outcome; });
    const abort = () => { f.expire(); release(); };
    context.signal.addEventListener('abort', abort, { once: true });
    try {
      await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_EXPECTED_HELD_WRITER_CLOSE'); })]);
      expect(settled).toBe(false);
      expect(closed).toBe(false);
    }
    finally {
      release();
      await work;
      context.signal.removeEventListener('abort', abort);
    }
    const outcome = await work;
    expect(outcome.ok).toBe(false);
    if (outcome.ok)
      throw new Error('SYNTHETIC_EXPECTED_AGGREGATE_FAILURE');
    expect(closed).toBe(true);
    expect(outcome.error).toBeInstanceOf(AggregateError);
    const errors = (outcome.error as AggregateError).errors as unknown[];
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe(first);
    expect(errors[1]).toBe(later);
    expect(await readFile(f.paths.nextPath)).toHaveLength(0);
    expect(await readdir(f.paths.directoryPath)).toEqual(['workspace-deletion-journal-v1.json.next']);
  }
});
it('initial publication rejects malformed read context before I/O', async (context) => {
  for (const invalid of [null, {}, { assertBeforeSlotRead: false }]) {
    const f = await fixture(context), selected = await f.select(), probe = initialPublicationProbe(f);
    let comparisons = 0, fullChecks = 0;
    const outcome = await initialPublicationOutcome(initialPublicationPublish(f, {
      ...selected, async assertExternalSelection() { fullChecks++; await selected.assertExternalSelection(); },
    }, async () => { comparisons++; }, invalid as unknown as InitialPublicationReadPort));
    expect(outcome.ok).toBe(false);
    {
      expect(probe.events).toEqual([]);
      expect(probe.completed).toEqual([]);
      expect(comparisons).toBe(0);
      expect(fullChecks).toBe(0);
      expect(await f.snapshot()).toEqual({});
      if (outcome.ok)
        throw new Error('SYNTHETIC_EXPECTED_INVALID_CONTEXT_REJECTION');
      expect(outcome.error).toBeInstanceOf(Error);
    }
  }
});
it('initial publication distinguishes competing full-selection and slot failures without mutation', async (context) => {
  const f = await fixture(context), selected = await f.select();
  await mkdir(f.paths.directoryPath, { mode: 0o700 });
  await writeFile(f.paths.currentPath, serializeWorkspaceDeletionJournal(journal()), { flag: 'wx', mode: 0o600 });
  const before = await f.snapshot(), first = new Error('SYNTHETIC_COMPETING_EXTERNAL_SELECTION_FAILURE');
  const probe = initialPublicationProbe(f);
  const result = await initialPublicationOutcome(initialPublicationPublish(f, {
    ...selected, async assertExternalSelection() { throw first; },
  }, async () => { }, { async assertBeforeSlotRead() { f.assertAuthority(); } }));
  expect(result.ok).toBe(false);
  if (result.ok)
    throw new Error('SYNTHETIC_EXPECTED_COMPETING_FAILURE');
  expect(result.error).toMatchObject({ name: 'CrashSafeByteSlotStoreError' });
  expect(probe.completed).toEqual([]);
  expect(await f.snapshot()).toEqual(before);
});
