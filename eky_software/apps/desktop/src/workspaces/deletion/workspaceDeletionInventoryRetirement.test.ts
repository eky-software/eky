import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { deletionTestHeader as header } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionInventoryDirectoryReads } from './workspaceDeletionInventoryFile.js';
import { assertWorkspaceDeletionInventoryRetired, retireWorkspaceDeletionInventory } from './workspaceDeletionInventoryRetirement.js';
import { deletionInventoryRetirementFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';
import { workspaceDeletionInventoryFileName as fileName } from './workspaceDeletionInventoryStore.js';
import { serializeWorkspaceDeletionJournal, workspaceDeletionPhases } from './workspaceDeletionJournalCodec.js';

it('retires only the committed inventory and then clears the journal last with a real absence port', async context => {
  const f = await fixture(context);
  const other = join(f.root, 'unrelated-company');
  const backup = join(f.root, 'user-export.ekybackup');
  await mkdir(other, { mode: 0o700 });
  await writeFile(join(other, 'preserved'), 'other-workspace');
  await writeFile(backup, 'external-backup');
  const journalBytes = await readFile(f.journalPaths.currentPath);
  await retireWorkspaceDeletionInventory(f.root, f.expected, f.authority);
  await expect(readdir(f.paths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(f.journalPaths.currentPath)).toEqual(journalBytes);
  await f.journal.clearTerminal(await f.select(), { assertInventoryAndOperationRootAbsent: () =>
    assertWorkspaceDeletionInventoryRetired(f.root, f.expected, f.authority) });
  expect((await f.journal.inspect(f.authority.assertAuthority)).plan.mode).toBe('absent');
  expect(await readFile(join(other, 'preserved'), 'utf8')).toBe('other-workspace');
  expect(await readFile(backup, 'utf8')).toBe('external-backup');
  expect(await readdir(f.paths.parentPath)).toHaveLength(0);
});

for (const phase of workspaceDeletionPhases.filter(value => value !== 'registryPublished')) {
  it(`refuses inventory retirement in ${phase} even if its files could be removed`, async context => {
    const f = await fixture(context, phase);
    const inventory = await f.snapshot();
    const journal = await readFile(f.journalPaths.currentPath);
    await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(inventory);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(journal);
  });
}

for (const sibling of ['next', 'backup'] as const) {
  it(`refuses terminal-current with a ${sibling} sibling before touching inventory`, async context => {
    const f = await fixture(context);
    const older = { ...f.expected, phase: sibling === 'backup' ? 'purged' as const : 'registryPublished' as const };
    await writeFile(sibling === 'next' ? f.journalPaths.nextPath : f.journalPaths.backupPath,
      serializeWorkspaceDeletionJournal(older), { flag: 'wx', mode: 0o600 });
    const before = await f.snapshot();
    await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(sibling === 'next' ? f.journalPaths.nextPath : f.journalPaths.backupPath)).toEqual(serializeWorkspaceDeletionJournal(older));
  });
}

it('does not treat an inventory without its journal as cleanup authority', async context => {
  const f = await fixture(context);
  await unlink(f.journalPaths.currentPath);
  const before = await f.snapshot();
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('rejects changed actual inventory bytes and preserves the journal and inventory', async context => {
  const f = await fixture(context);
  const changed = await readFile(f.paths.currentPath);
  changed[0] = 32;
  await writeFile(f.paths.currentPath, changed);
  const before = await f.snapshot();
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(f.expected));
});

for (const fault of ['beforeUnlink', 'afterUnlink', 'inventorySync', 'beforeRmdir', 'afterRmdir', 'parentSync'] as const) {
  it(`retains terminal journal after ${fault} and resumes only technical cleanup`, async context => {
    const f = await fixture(context);
    const first = new Error(`SYNTHETIC_${fault}`);
    const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
    f.fileSystem.removeSlot = async (...args) => {
      if (fault === 'beforeUnlink') throw first;
      const result = await remove(...args);
      if (fault === 'afterUnlink') throw first;
      return result;
    };
    const sync = f.fileSystem.syncDirectory.bind(f.fileSystem);
    f.fileSystem.syncDirectory = async (...args) => { await sync(...args); if (fault === 'inventorySync') throw first; };
    const parent = createNodeCrashSafeFileSlotFileSystem({ ...f.paths, directoryPath: f.paths.parentPath }, 1);
    const parentSync = parent.syncDirectory.bind(parent);
    parent.syncDirectory = async (...args) => { await parentSync(...args); if (fault === 'parentSync') throw first; };
    await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, {
      inventory: f.fileSystem, parent,
      async removeDirectory(path) {
        if (fault === 'beforeRmdir') throw first;
        await rmdir(path);
        if (fault === 'afterRmdir') throw first;
      },
    })).rejects.toBe(first);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(f.expected));
    if (fault === 'beforeUnlink') expect(await readdir(f.paths.directoryPath)).toEqual([fileName]);
    else if (fault === 'afterUnlink' || fault === 'inventorySync' || fault === 'beforeRmdir') {
      expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
    } else await expect(readdir(f.paths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await retireWorkspaceDeletionInventory(f.root, f.expected, f.authority);
    await assertWorkspaceDeletionInventoryRetired(f.root, f.expected, f.authority);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(f.expected));
  });
}

it('does not remove a foreign file beside the inventory or declare it retired', async context => {
  const f = await fixture(context);
  const foreign = join(f.paths.directoryPath, 'foreign');
  await writeFile(foreign, 'preserved');
  const before = await f.snapshot();
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority)).rejects.toThrow();
  await expect(assertWorkspaceDeletionInventoryRetired(f.root, f.expected, f.authority)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('preserves a late foreign entry when rmdir finds the directory no longer empty', async context => {
  const f = await fixture(context);
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { async removeDirectory(path) {
    await writeFile(join(path, 'late-foreign'), 'preserved');
    await rmdir(path);
  } })).rejects.toThrow();
  expect(await readFile(join(f.paths.directoryPath, 'late-foreign'), 'utf8')).toBe('preserved');
  expect(await readFile(f.journalPaths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(f.expected));
});

it('rejects target changes during the journal slot read before any inventory deletion', async context => {
  const f = await fixture(context);
  const read = f.journalSystem.readSlot.bind(f.journalSystem);
  f.journalSystem.readSlot = async (...args) => {
    const result = await read(...args);
    if (args[0] === 'next') f.changeTarget();
    return result;
  };
  const before = await f.snapshot();
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { journal: f.journalSystem })).rejects.toThrow('SYNTHETIC_TARGET_CHANGED');
  expect(await f.snapshot()).toEqual(before);
});

it('stops after post-unlink lease loss and allows a fresh owner only with the surviving terminal', async context => {
  const f = await fixture(context);
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  f.fileSystem.removeSlot = async (...args) => { const removed = await remove(...args); f.expire(); return removed; };
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { inventory: f.fileSystem })).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(f.expected));
  const freshAuthority = { assertAuthority() {}, async assertExternalSelection() {} };
  await retireWorkspaceDeletionInventory(f.root, f.expected, freshAuthority);
  await assertWorkspaceDeletionInventoryRetired(f.root, f.expected, freshAuthority);
});

it('refuses a replaced terminal journal inode even with identical bytes', async context => {
  const f = await fixture(context);
  const read = f.journalSystem.readSlot.bind(f.journalSystem);
  let reads = 0;
  f.journalSystem.readSlot = async (...args) => {
    const result = await read(...args);
    if (args[0] === 'next' && ++reads === 1) {
      await rename(f.journalPaths.currentPath, join(f.root, 'retained-journal'));
      await writeFile(f.journalPaths.currentPath, serializeWorkspaceDeletionJournal(f.expected), { flag: 'wx', mode: 0o600 });
    }
    return result;
  };
  const before = await f.snapshot();
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, { journal: f.journalSystem })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('refuses a recreated operation directory even after the inventory was already removed', async context => {
  const f = await fixture(context);
  await unlink(f.paths.currentPath);
  await rename(f.paths.directoryPath, join(f.root, 'retained-empty-root'));
  await mkdir(f.paths.directoryPath, { mode: 0o700 });
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority)).rejects.toThrow();
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  expect(await readdir(f.paths.parentPath)).toEqual([header.operationId]);
});

it('preserves both roots when the original empty root is replaced during the last terminal read', async context => {
  const f = await fixture(context);
  const retained = join(f.root, 'retained-original-root');
  let emptySeen = false;
  let rootCheckedAfterEmpty = false;
  let replaced = false;
  const read = f.journalSystem.readSlot.bind(f.journalSystem);
  f.journalSystem.readSlot = async (...args) => {
    const result = await read(...args);
    if (args[0] === 'next' && rootCheckedAfterEmpty && !replaced) {
      await rename(f.paths.directoryPath, retained);
      await mkdir(f.paths.directoryPath, { mode: 0o700 });
      replaced = true;
    }
    return result;
  };
  await expect(retireWorkspaceDeletionInventory(f.root, f.expected, f.authority, {
    journal: f.journalSystem,
    directories: {
      async identity(...args) {
        const result = await workspaceDeletionInventoryDirectoryReads.identity(...args);
        if (args[0] === f.paths.directoryPath && emptySeen) rootCheckedAfterEmpty = true;
        return result;
      },
      async names(...args) {
        const result = await workspaceDeletionInventoryDirectoryReads.names(...args);
        if (result.length === 0) emptySeen = true;
        return result;
      },
    },
  })).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(replaced).toBe(true);
  expect(await readdir(retained)).toHaveLength(0);
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(f.expected));
});
