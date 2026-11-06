import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import * as slotFileSystem from '../persistence/crashSafeFileSlot.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalSerializer.js';
import { validateWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalValidation.js';
import { inspectWorkspaceBackupImportBindingAdmission } from '../import/workspaceBackupImportBindingAdmission.js';
import { snapshotImportBindingFiles as snapshot } from '../import/workspaceBackupImportBindingTestSupport.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { readColdWorkspaceRecoveryAdmissionFromRoot } from './workspaceColdRecoveryAdmissionComposition.js';

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const required = 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED';

describe('cold import binding admission', () => {
  it.for(['current', 'backup', 'next'] as const)('keeps supported unbound v2 recovery from journal %s without repair', async (slot, context) => {
    const f = await fixture(context, false, slot);
    const before = await snapshot(f.root);
    await expect(inspectWorkspaceBackupImportBindingAdmission(f.root, f.journal)).resolves.toBe('unbound');
    await expect(f.read()).resolves.toBe('import');
    expect(await snapshot(f.root)).toEqual(before);
    expect(await readdir(f.root)).not.toContain('workspace-state');
  });

  it.for([false, true])('admits a matching published binding with known lineage=%s without cleanup', async (known, context) => {
    const f = await fixture(context, known);
    await f.putBinding('current');
    const before = await snapshot(f.root);
    await expect(inspectWorkspaceBackupImportBindingAdmission(f.root, f.journal)).resolves.toBe('bound');
    await expect(f.read()).resolves.toBe('import');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it.for(['next', 'backup'] as const)('allows same-value %s beside a published current without repairing either', async (slot, context) => {
    const f = await fixture(context);
    await f.putBinding('current'); await f.putBinding(slot);
    const before = await snapshot(f.root);
    await expect(f.read()).resolves.toBe('import');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it.for(['next', 'backup'] as const)('rejects %s-only metadata instead of falling back to unbound', async (slot, context) => {
    const f = await fixture(context);
    await f.putBinding(slot);
    const before = await snapshot(f.root);
    await expect(f.read()).rejects.toThrow(required);
    expect(await snapshot(f.root)).toEqual(before);
  });

  it.for(['target', 'lineage', 'operation', 'owner', 'malformed', 'conflict'] as const)(
    'rejects %s metadata and retains journal and payload evidence', async (change, context) => {
      const f = await fixture(context, true);
      if (change === 'malformed') {
        await mkdir(dirname(f.bindingPaths.currentPath), { recursive: true, mode: 0o700 });
        await writeFile(f.bindingPaths.currentPath, '{}\n', { flag: 'wx' });
      } else if (change === 'conflict') {
        await f.putBinding('current');
        await f.putBinding('backup', { ...f.binding, workspaceId: '22222222-2222-4222-8222-222222222222' });
      } else {
        const value = change === 'target' ? { ...f.binding, workspaceId: '22222222-2222-4222-8222-222222222222' }
          : change === 'lineage' ? { ...f.binding, lineageIdentity: { formatVersion: 1, profileId: 'b'.repeat(64) } }
          : change === 'operation' ? { ...f.binding, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
          : { ...f.binding, owner: 'workspaceReplacement' };
        await f.putBinding('current', value);
      }
      const before = await snapshot(f.root);
      await expect(f.read()).rejects.toThrow(required);
      expect(await snapshot(f.root)).toEqual(before);
      expect(await readFile(f.payload, 'utf8')).toBe('synthetic evidence');
    });

  it('rejects journal replacement across the binding read instead of adopting a new operation key', async context => {
    const f = await fixture(context);
    await f.putBinding('current');
    const inspect = WorkspaceRemnantBindingStore.prototype.inspect;
    const changed = validateWorkspaceBackupImportJournal({ ...f.journal, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const spy = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect').mockImplementationOnce(async function (this: WorkspaceRemnantBindingStore, ...args) {
      await writeFile(f.journalPaths.currentPath, serializeWorkspaceBackupImportJournal(changed));
      return inspect.apply(this, args);
    });
    try { await expect(f.read()).rejects.toThrow(required); }
    finally { spy.mockRestore(); }
    expect(await readFile(f.journalPaths.currentPath)).toEqual(Buffer.from(serializeWorkspaceBackupImportJournal(changed)));
    expect(await readFile(f.bindingPaths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
    expect(await readFile(f.payload, 'utf8')).toBe('synthetic evidence');
  });

  it.for([false, true])('rejects journal replacement during binding-slot I/O, published=%s', async (published, context) => {
    const f = await fixture(context);
    if (published) await f.putBinding('current');
    const create = slotFileSystem.createNodeCrashSafeFileSlotFileSystem;
    const changed = validateWorkspaceBackupImportJournal({ ...f.journal, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    let injected = false;
    const spy = vi.spyOn(slotFileSystem, 'createNodeCrashSafeFileSlotFileSystem').mockImplementation((...args) => {
      const fs = create(...args);
      if (args[0].currentPath !== f.bindingPaths.currentPath) return fs;
      return { ...fs, async readSlot(...readArgs) {
        const bytes = await fs.readSlot(...readArgs);
        if (!injected && readArgs[0] === 'current') {
          injected = true;
          await writeFile(f.journalPaths.currentPath, serializeWorkspaceBackupImportJournal(changed));
        }
        return bytes;
      } };
    });
    try { await expect(f.read()).rejects.toThrow(required); }
    finally { spy.mockRestore(); }
    expect(injected).toBe(true);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(Buffer.from(serializeWorkspaceBackupImportJournal(changed)));
    if (published) expect(await readFile(f.bindingPaths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
    else await expect(readFile(f.bindingPaths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.payload, 'utf8')).toBe('synthetic evidence');
  });

  it.for(['next', 'backup'] as const)('rejects malformed binding %s beside valid current through admission', async (slot, context) => {
    const f = await fixture(context);
    await f.putBinding('current');
    await writeFile(f.bindingPaths[`${slot}Path`], '{}\n', { flag: 'wx' });
    const before = await snapshot(f.root);
    await expect(f.read()).rejects.toThrow(required);
    expect(await snapshot(f.root)).toEqual(before);
    expect(await readFile(f.bindingPaths[`${slot}Path`], 'utf8')).toBe('{}\n');
  });
});

async function fixture(context: TestContext, known = false, journalSlot: 'current' | 'next' | 'backup' = 'current') {
  const root = await mkdtemp(join(tmpdir(), 'eky-cold-import-binding-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
  await registry.write({ formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
  const journal = validateWorkspaceBackupImportJournal({ formatVersion: 2, operationId, workspaceId,
    workspaceLabel: 'Synthetic import', previousActiveWorkspaceId: null, state: known ? 'rootPublished' : 'prepared',
    createdAt: '2026-10-29T09:00:00.000Z', lineageIdentity: known ? { formatVersion: 1, profileId: 'a'.repeat(64) } : null });
  const journalPaths = createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
  await writeFile(journalPaths[`${journalSlot}Path`], serializeWorkspaceBackupImportJournal(journal), { flag: 'wx' });
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport', operationId,
    workspaceId, lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) } });
  const bindingPaths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceImport', operationId });
  const payload = join(root, 'synthetic-evidence');
  await writeFile(payload, 'synthetic evidence', { flag: 'wx' });
  async function putBinding(slot: 'current' | 'next' | 'backup', value: unknown = binding) {
    await mkdir(dirname(bindingPaths.currentPath), { recursive: true, mode: 0o700 });
    await writeFile(bindingPaths[`${slot}Path`], serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding(value)), { flag: 'wx' });
  }
  return { root, journal, journalPaths, binding, bindingPaths, payload, putBinding,
    read: () => readColdWorkspaceRecoveryAdmissionFromRoot(root) };
}
