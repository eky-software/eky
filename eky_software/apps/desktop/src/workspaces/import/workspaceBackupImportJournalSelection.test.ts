import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeWorkspaceBackupImportJournalFileSystem } from './workspaceBackupImportJournalFileSystem.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from './workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { WorkspaceBackupImportJournalStore } from './workspaceBackupImportJournalStore.js';
import { validateWorkspaceBackupImportJournal, WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES } from './workspaceBackupImportJournalValidation.js';
import type { WorkspaceBackupImportJournalState } from './workspaceBackupImportTypes.js';

describe('selected workspace import journal I/O', () => {
  it.for([1, 2] as const)('writes every current v%s transition without a repairing read', async (version, context) => {
    const f = await fixture(context);
    for (const state of WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES) {
      const next = journal(state, version);
      const identity = await f.store.writeSelected(next, await f.select());
      const slots = await f.store.inspectSlots();
      expect(slots.current?.value).toEqual(next);
      expect(slots.current?.identity).toEqual(identity);
      expect(slots.next).toBeUndefined(); expect(slots.backup).toBeUndefined();
    }
    await f.store.removeSelected(journal('registryPublished', version).operationId, await f.select());
    expect(await f.store.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
    expect(f.external).toHaveBeenCalled();
  });

  it.for(['current', 'next', 'backup'] as const)('inspects a %s-only journal without moving or deleting it', async (slot, context) => {
    const f = await fixture(context);
    const bytes = serializeWorkspaceBackupImportJournal(journal('prepared'));
    await writeFile(f.paths[`${slot}Path`], bytes, { flag: 'wx' });
    expect((await f.store.inspectSlots())[slot]?.value).toEqual(journal('prepared'));
    expect(await readFile(f.paths[`${slot}Path`])).toEqual(Buffer.from(bytes));
    expect(await readdir(f.root)).toEqual([f.paths[`${slot}Path`].split(/[\\/]/).at(-1)]);
  });

  it.for(['next', 'backup'] as const)('rejects a %s sibling rather than repairing it before a live write', async (slot, context) => {
    const f = await fixture(context);
    await f.store.write(journal('prepared'));
    const bytes = await readFile(f.paths.currentPath);
    await writeFile(f.paths[`${slot}Path`], bytes, { flag: 'wx' });
    await expect(f.store.writeSelected(journal('candidateRootCreated'), await f.select())).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID');
    expect(await readFile(f.paths[`${slot}Path`])).toEqual(bytes);
    expect(await readFile(f.paths.currentPath)).toEqual(bytes);
  });

  it.for(['identity', 'bytes', 'next'] as const)('rejects %s change after readonly selection', async (change, context) => {
    const f = await fixture(context);
    await f.store.write(journal('prepared'));
    const selected = await f.select();
    const before = await readFile(f.paths.currentPath);
    if (change === 'identity') { await rename(f.paths.currentPath, `${f.paths.currentPath}.preserved`); await writeFile(f.paths.currentPath, before, { flag: 'wx' }); }
    if (change === 'bytes') await writeFile(f.paths.currentPath, serializeWorkspaceBackupImportJournal(journal('candidateRootCreated')));
    if (change === 'next') await writeFile(f.paths.nextPath, before, { flag: 'wx' });
    const current = await readFile(f.paths.currentPath);
    await expect(f.store.writeSelected(journal('candidateRootCreated'), selected)).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE');
    expect(await readFile(f.paths.currentPath)).toEqual(current);
    if (change === 'next') expect(await readFile(f.paths.nextPath)).toEqual(before);
  });

  it.for(['operation', 'format', 'skip'] as const)('retains bytes on invalid %s transition', async (change, context) => {
    const f = await fixture(context);
    await f.store.write(journal('prepared'));
    const next = change === 'operation' ? { ...journal('candidateRootCreated'), operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
      : change === 'format' ? journal('candidateRootCreated', 1) : journal('backupStaged');
    await expect(f.store.writeSelected(next, await f.select())).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID');
    expect(await readFile(f.paths.currentPath)).toEqual(Buffer.from(serializeWorkspaceBackupImportJournal(journal('prepared'))));
  });

  it.for(['prepared', 'candidateRootCreated', 'backupStaged', 'candidateMigrated', 'candidateValidated'] as const)(
    'discards only the selected pre-publication %s journal', async (state, context) => {
      const f = await fixture(context);
      await writeFile(f.paths.currentPath, serializeWorkspaceBackupImportJournal(journal(state)), { flag: 'wx' });
      await f.store.discardBeforePublicationSelected(journal(state).operationId, await f.select());
      expect(await readdir(f.root)).toEqual([]);
    });

  it.for(['rootPublished', 'registryPublished'] as const)('does not discard selected %s publication', async (state, context) => {
    const f = await fixture(context);
    const bytes = serializeWorkspaceBackupImportJournal(journal(state));
    await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
    await expect(f.store.discardBeforePublicationSelected(journal(state).operationId, await f.select())).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID');
    expect(await readFile(f.paths.currentPath)).toEqual(Buffer.from(bytes));
  });

  it('requires the selected operation and terminal state before removal', async context => {
    const f = await fixture(context);
    await f.store.write(journal('prepared'));
    const operation = journal('registryPublished').operationId;
    await expect(f.store.removeSelected(operation, await f.select())).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID');
    await expect(f.store.discardBeforePublicationSelected('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as typeof operation,
      await f.select())).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID');
    expect((await f.store.inspectSlots()).current?.value).toEqual(journal('prepared'));
  });

  it('checks external authority before terminal deletion', async context => {
    const f = await fixture(context);
    await writeFile(f.paths.currentPath, serializeWorkspaceBackupImportJournal(journal('registryPublished')), { flag: 'wx' });
    const selected = await f.select();
    f.external.mockRejectedValueOnce(new Error('SYNTHETIC_SELECTION_LOST'));
    await expect(f.store.removeSelected(journal('registryPublished').operationId, selected)).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE');
    expect((await f.store.inspectSlots()).current?.value).toEqual(journal('registryPublished'));
  });

  it('checks synchronous authority after readonly I/O and retains the slot', async context => {
    const f = await fixture(context);
    await f.store.write(journal('prepared'));
    const read = f.fs.readSlot.bind(f.fs);
    vi.spyOn(f.fs, 'readSlot').mockImplementationOnce(async (...args) => { const bytes = await read(...args); f.state.current = false; return bytes; });
    await expect(f.store.inspectSlots(f.assertCurrent)).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE');
    expect(await readFile(f.paths.currentPath)).toEqual(Buffer.from(serializeWorkspaceBackupImportJournal(journal('prepared'))));
  });

  it('retains current and backup on a lost publication acknowledgement', async context => {
    const f = await fixture(context);
    await f.store.write(journal('prepared'));
    const move = f.fs.moveSlot.bind(f.fs);
    vi.spyOn(f.fs, 'moveSlot').mockImplementation(async (...args) => { await move(...args); if (args[1] === 'current') throw new Error('SYNTHETIC_ACK_LOST'); });
    await expect(f.store.writeSelected(journal('candidateRootCreated'), await f.select())).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE');
    expect((await f.store.inspectSlots()).current?.value).toEqual(journal('candidateRootCreated'));
    expect((await f.store.inspectSlots()).backup?.value).toEqual(journal('prepared'));
  });

  it('rejects malformed siblings without deleting or repairing any slot', async context => {
    const f = await fixture(context);
    await f.store.write(journal('prepared'));
    await writeFile(f.paths.nextPath, '{}\n', { flag: 'wx' });
    await expect(f.store.inspectSlots()).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID');
    expect(await readFile(f.paths.nextPath, 'utf8')).toBe('{}\n');
    expect(await readFile(f.paths.currentPath)).toEqual(Buffer.from(serializeWorkspaceBackupImportJournal(journal('prepared'))));
  });
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-import-journal-selected-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
  const fs = createNodeWorkspaceBackupImportJournalFileSystem(paths);
  const store = new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: paths.currentPath, fileSystem: fs });
  const state = { current: true };
  const assertCurrent = () => { if (!state.current) throw new Error('SYNTHETIC_OWNER_EXPIRED'); };
  const external = vi.fn(async () => {});
  async function select(): Promise<CrashSafeByteSlotSelection> {
    const slots = await store.inspectSlots(assertCurrent);
    return { expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
      expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity },
      assertAuthority: assertCurrent, assertExternalSelection: external };
  }
  return { root, paths, fs, store, state, assertCurrent, external, select };
}

function journal(state: WorkspaceBackupImportJournalState, formatVersion: 1 | 2 = 2) {
  const validated = ['candidateValidated', 'rootPublished', 'registryPublished'].includes(state);
  return validateWorkspaceBackupImportJournal({ formatVersion, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspaceId: '11111111-1111-4111-8111-111111111111', workspaceLabel: 'Synthetic imported', previousActiveWorkspaceId: null,
    state, createdAt: '2026-10-29T09:00:00.000Z', lineageIdentity: validated ? { formatVersion: 1, profileId: 'a'.repeat(64) } : null });
}
