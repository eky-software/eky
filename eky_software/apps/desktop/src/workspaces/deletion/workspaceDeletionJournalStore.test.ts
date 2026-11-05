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
