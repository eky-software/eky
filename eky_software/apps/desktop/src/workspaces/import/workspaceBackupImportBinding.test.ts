import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceBackupImportBinding, type WorkspaceBackupImportBindingOptions } from './workspaceBackupImportBinding.js';
import { createImportBindingFixture, importBindingOperationId as operationId, importBindingWorkspaceId as workspaceId,
  snapshotImportBindingFiles as snapshot } from './workspaceBackupImportBindingTestSupport.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';

describe('workspace import binding and registry authority', () => {
  it.for([false, true])('accepts exactly its own append, selector=%s', async (selector, context) => {
    const f = await createImportBindingFixture(context, selector);
    await f.binding.publish();
    await f.binding.assertPublished();
    expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8'))).toMatchObject({ owner: 'workspaceImport', operationId, workspaceId });
    await f.binding.publishRegistry(f.entry, f.checkJournal);
    await f.binding.assertPublished();
    expect(f.binding.assertMutationCurrent()).toBeUndefined();
    expect((await f.registry.inspectSlots()).current?.value).toEqual(f.expected);
    expect(f.expected.activeWorkspaceId).toBe(f.original.activeWorkspaceId);
    expect(f.checkJournal).toHaveBeenCalled();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('does not grant mutation before publication or while publication is incomplete', async context => {
    const f = await createImportBindingFixture(context);
    expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(f.onUncertain).not.toHaveBeenCalled();
    await f.binding.publish();
    expect(f.binding.assertMutationCurrent()).toBeUndefined();
  });

  it.for([undefined, null, {}, { release: async () => {} }])('rejects missing or foreign exact lease: %j', async (lease, context) => {
    const f = await createImportBindingFixture(context);
    const before = await snapshot(f.root);
    expect(() => new WorkspaceBackupImportBinding({ ...f.options,
      lease: lease as WorkspaceBackupImportBindingOptions['lease'] })).toThrow();
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('captures the original registry identity before the first await', async context => {
    const f = await createImportBindingFixture(context);
    await rename(f.registryPaths.currentPath, `${f.registryPaths.currentPath}.preserved`);
    await writeFile(f.registryPaths.currentPath, f.selection.current!.bytes, { flag: 'wx' });
    const before = await snapshot(f.root);
    await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('captures its buffers and callbacks rather than using replacement caller options', async context => {
    const f = await createImportBindingFixture(context);
    f.selection.current!.bytes.fill(0);
    f.options.registry.inspectSlots = async () => { throw new Error('REPLACED_READER'); };
    f.options.mainOwner.assertCurrent = () => { throw new Error('REPLACED_OWNER'); };
    await f.binding.publish();
    await f.binding.assertPublished();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('rejects ordinary label validation before registry publication without poisoning valid cleanup', async context => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    expect(() => f.binding.publishRegistry({ ...f.entry, workspaceLabel: f.original.workspaces[0]!.workspaceLabel },
      f.checkJournal)).toThrow('WORKSPACE_IMPORT_LABEL_EXISTS');
    await f.binding.assertPublished();
    expect(f.binding.assertMutationCurrent()).toBeUndefined();
    expect((await f.registry.inspectSlots()).current?.value).toEqual(f.original);
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it.for(['workspace', 'lineage'] as const)('rejects an entry for another %s without registry I/O', async (change, context) => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    const before = await snapshot(f.root);
    const foreign = change === 'workspace' ? { ...f.entry, workspaceId: f.original.workspaces[0]!.workspaceId }
      : { ...f.entry, lineageIdentity: { formatVersion: 1 as const, profileId: 'c'.repeat(64) } };
    expect(() => f.binding.publishRegistry(foreign, f.checkJournal)).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.checkJournal).not.toHaveBeenCalled();
  });

  it.for(['bytes', 'identity', 'next', 'backup', 'bindingIdentity', 'bindingMissing', 'bindingSide'] as const)(
    'preserves all files on foreign %s after binding publication', async (change, context) => {
      const f = await createImportBindingFixture(context);
      await f.binding.publish();
      if (change === 'bytes') await writeFile(f.registryPaths.currentPath, serializeWorkspaceRegistry(f.expected));
      else if (change === 'identity' || change === 'bindingIdentity') {
        const path = change === 'identity' ? f.registryPaths.currentPath : f.paths.currentPath;
        const bytes = await readFile(path); await rename(path, `${path}.preserved`); await writeFile(path, bytes, { flag: 'wx' });
      } else if (change === 'bindingMissing') await rename(f.paths.currentPath, `${f.paths.currentPath}.preserved`);
      else {
        const paths = change === 'bindingSide' ? f.paths : f.registryPaths;
        const path = change === 'backup' ? paths.backupPath : paths.nextPath;
        await writeFile(path, await readFile(paths.currentPath), { flag: 'wx' });
      }
      const before = await snapshot(f.root);
      await expect(f.binding.assertPublished()).rejects.toThrow();
      expect(await snapshot(f.root)).toEqual(before);
      await expect(f.binding.publishRegistry(f.entry, f.checkJournal)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      expect(f.onUncertain).toHaveBeenCalledOnce();
    });

  it.for(['main', 'owned', 'runtime', 'lease'] as const)('latches %s loss without adopting a later owner', async (loss, context) => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    if (loss === 'main') f.state.current = false;
    if (loss === 'owned') f.state.owned = false;
    if (loss === 'runtime') f.state.absent = false;
    if (loss === 'lease') { await f.held.release(); await f.lease.acquire('import'); }
    const before = await snapshot(f.root);
    await expect(f.binding.assertPublished()).rejects.toThrow();
    Object.assign(f.state, { current: true, owned: true, absent: true });
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('does not accept a new registry selection without the writer acknowledgement', async context => {
    const f = await createImportBindingFixture(context);
    const write = f.options.registry.writeSelected.bind(f.registry);
    const primary = new Error('SYNTHETIC_REGISTRY_ACK_LOST');
    const binding = new WorkspaceBackupImportBinding({ ...f.options,
      registry: { inspectSlots: f.registry.inspectSlots.bind(f.registry), async writeSelected(...args) { await write(...args); throw primary; } } }, f.fileSystem);
    await binding.publish();
    await expect(binding.publishRegistry(f.entry, f.checkJournal)).rejects.toBe(primary);
    expect((await f.registry.inspectSlots()).current?.value).toEqual(f.expected);
    const before = await snapshot(f.root);
    await expect(binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    await expect(binding.publishRegistry(f.entry, f.checkJournal)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(() => binding.assertMutationCurrent()).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('rejects equal-byte registry replacement between writer receipt and readback', async context => {
    const f = await createImportBindingFixture(context);
    const write = f.registry.writeSelected.bind(f.registry);
    const binding = new WorkspaceBackupImportBinding({ ...f.options,
      registry: { inspectSlots: f.registry.inspectSlots.bind(f.registry), async writeSelected(...args) {
        const receipt = await write(...args);
        const bytes = await readFile(f.registryPaths.currentPath);
        await rename(f.registryPaths.currentPath, `${f.registryPaths.currentPath}.preserved`);
        await writeFile(f.registryPaths.currentPath, bytes, { flag: 'wx' });
        return receipt;
      } } }, f.fileSystem);
    await binding.publish();
    await expect(binding.publishRegistry(f.entry, f.checkJournal)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    const before = await snapshot(f.root);
    await expect(binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('rejects equal-byte binding replacement between its receipt and readback', async context => {
    const f = await createImportBindingFixture(context);
    const publish = WorkspaceRemnantBindingStore.prototype.publish;
    const spy = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementationOnce(async function (this: WorkspaceRemnantBindingStore, ...args) {
      const receipt = await publish.apply(this, args);
      const bytes = await readFile(f.paths.currentPath);
      await rename(f.paths.currentPath, `${f.paths.currentPath}.preserved`);
      await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
      return receipt;
    });
    try { await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED'); }
    finally { spy.mockRestore(); }
    const before = await snapshot(f.root);
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('retains its published registry when the journal fails only after receipt and readback', async context => {
    const f = await createImportBindingFixture(context);
    const write = f.registry.writeSelected.bind(f.registry);
    const primary = new Error('SYNTHETIC_JOURNAL_AFTER_PUBLICATION');
    let published = false;
    let readBack = false;
    const binding = new WorkspaceBackupImportBinding({ ...f.options, registry: {
      async writeSelected(...args) { const receipt = await write(...args); published = true; return receipt; },
      async inspectSlots(...args) { const slots = await f.registry.inspectSlots(...args); if (published) readBack = true; return slots; },
    } }, f.fileSystem);
    await binding.publish();
    await expect(binding.publishRegistry(f.entry, async () => { if (readBack) throw primary; })).rejects.toBe(primary);
    expect((await f.registry.inspectSlots()).current?.value).toEqual(f.expected);
    const before = await snapshot(f.root);
    expect(() => binding.assertMutationCurrent()).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    await expect(binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('requires a fresh journal without re-entering the active registry writer', async context => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    const primary = new Error('SYNTHETIC_JOURNAL_CHANGED');
    f.checkJournal.mockRejectedValueOnce(primary);
    await expect(f.binding.publishRegistry(f.entry, f.checkJournal)).rejects.toMatchObject({ errors: [
      primary, { message: 'WORKSPACE_REGISTRY_UNAVAILABLE' },
    ] });
    expect((await f.registry.inspectSlots()).current?.value).toEqual(f.original);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('rejects a second acknowledged append instead of extending the imported selection', async context => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish(); await f.binding.publishRegistry(f.entry, f.checkJournal);
    const before = await snapshot(f.root);
    await expect(f.binding.publishRegistry(f.entry, f.checkJournal)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('never removes a candidate or binding as a side effect of authority checks', async context => {
    const f = await createImportBindingFixture(context);
    await writeFile(`${f.root}/synthetic-payload`, 'preserved');
    await f.binding.publish(); await f.binding.publishRegistry(f.entry, f.checkJournal);
    await f.binding.assertPublished();
    expect(await readFile(`${f.root}/synthetic-payload`, 'utf8')).toBe('preserved');
    expect(await readdir(f.paths.directoryPath)).toEqual([`${operationId}.json`]);
  });
});
