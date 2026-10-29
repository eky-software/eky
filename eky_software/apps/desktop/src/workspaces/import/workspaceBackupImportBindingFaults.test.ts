import { readFile, readdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceBackupImportBinding } from './workspaceBackupImportBinding.js';
import { createImportBindingFixture, importBindingGate as gate, snapshotImportBindingFiles as snapshot } from './workspaceBackupImportBindingTestSupport.js';

describe('workspace import binding interrupted I/O', () => {
  it.for(['main', 'lease', 'owned', 'runtime', 'registry'] as const)(
    'renews %s authority after binding I/O and closes the opened writer', async (loss, context) => {
      const f = await createImportBindingFixture(context);
      const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
      let closed = false;
      f.fileSystem.createNextWriter = async guard => {
        const writer = await open(guard);
        return { write: writer.write.bind(writer), readIdentity: () => writer.readIdentity!(),
          async sync() {
            await writer.sync();
            if (loss === 'main') f.state.current = false;
            if (loss === 'owned') f.state.owned = false;
            if (loss === 'runtime') f.state.absent = false;
            if (loss === 'lease') { await f.held.release(); await f.lease.acquire('import'); }
            if (loss === 'registry') await writeFile(f.registryPaths.backupPath, f.selection.current!.bytes, { flag: 'wx' });
          }, async close() { await writer.close(); closed = true; } };
      };
      await expect(f.binding.publish()).rejects.toThrow();
      expect(closed).toBe(true);
      expect(await readFile(f.paths.nextPath, 'utf8')).toContain('workspaceImport');
      expect(f.onUncertain).toHaveBeenCalledOnce();
      const before = await snapshot(f.root);
      await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      expect(await snapshot(f.root)).toEqual(before);
    });

  it('retains published binding bytes after a lost rename acknowledgement', async context => {
    const f = await createImportBindingFixture(context);
    const move = f.fileSystem.moveSlot.bind(f.fileSystem);
    const primary = new Error('SYNTHETIC_BINDING_ACK_LOST');
    f.fileSystem.moveSlot = async (...args) => { await move(...args); throw primary; };
    await expect(f.binding.publish()).rejects.toBe(primary);
    expect(await readFile(f.paths.currentPath, 'utf8')).toContain('workspaceImport');
    const before = await snapshot(f.root);
    await expect(f.binding.publish()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('retains registry current and backup after the writer loses the final rename acknowledgement', async context => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    const move = f.registryFs.moveSlot.bind(f.registryFs);
    f.registryFs.moveSlot = async (...args) => {
      await move(...args);
      if (args[1] === 'current') throw new Error('SYNTHETIC_REGISTRY_RENAME_ACK_LOST');
    };
    await expect(f.binding.publishRegistry(f.entry, f.checkJournal)).rejects.toThrow();
    expect((await f.registry.inspectSlots()).current?.value).toEqual(f.expected);
    expect(await readFile(f.registryPaths.backupPath)).toEqual(Buffer.from(f.selection.current!.bytes));
    const before = await snapshot(f.root);
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it.for(['before', 'after'] as const)('catches registry changes across binding reads %s registry publication', async (phase, context) => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    if (phase === 'after') await f.binding.publishRegistry(f.entry, f.checkJournal);
    const read = f.fileSystem.readSlot.bind(f.fileSystem);
    let inject = true;
    f.fileSystem.readSlot = async (...args) => {
      const bytes = await read(...args);
      if (inject && args[0] === 'current') {
        inject = false;
        await writeFile(f.registryPaths.nextPath, await readFile(f.registryPaths.currentPath), { flag: 'wx' });
      }
      return bytes;
    };
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    const before = await snapshot(f.root);
    expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('waits for a pending writer close instead of treating a rejected wait as ownership', async context => {
    const f = await createImportBindingFixture(context);
    const entered = gate(); const finish = gate();
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    let closed = false;
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { write: writer.write.bind(writer), sync: writer.sync.bind(writer), readIdentity: () => writer.readIdentity!(),
        async close() { entered.resolve(); await finish.promise; await writer.close(); closed = true; } };
    };
    const pending = f.binding.publish().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('CLOSE_NOT_ENTERED'); })]);
      expect(closed).toBe(false);
      expect(() => f.binding.assertMutationCurrent()).toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      expect(f.onUncertain).toHaveBeenCalledOnce();
      f.lease.captureCurrentOwner(['import'], f.held)();
    } finally { finish.resolve(); result = await pending; }
    expect(result).toBeInstanceOf(Error);
    expect(closed).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('rejects overlap while keeping the original pending I/O joined', async context => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    const entered = gate(); const finish = gate();
    f.assertOwned.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
    const pending = f.binding.assertPublished().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('OWNER_NOT_ENTERED'); })]);
      await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      f.lease.captureCurrentOwner(['import'], f.held)();
    } finally { finish.resolve(); result = await pending; }
    expect(result).toBeInstanceOf(Error);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('preserves write, close and uncertainty-notification failures in order', async context => {
    const f = await createImportBindingFixture(context);
    const primary = new Error('SYNTHETIC_WRITE'); const close = new Error('SYNTHETIC_CLOSE'); const notify = new Error('SYNTHETIC_NOTIFY');
    f.onUncertain.mockImplementation(() => { throw notify; });
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { async write() { throw primary; }, sync: writer.sync.bind(writer),
        async close() { await writer.close(); throw close; } };
    };
    await expect(f.binding.publish()).rejects.toMatchObject({ errors: [{ errors: [primary, close] }, notify] });
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('retains the first guard failure while the failing reader still closes', async context => {
    const f = await createImportBindingFixture(context);
    const entered = gate(); const finish = gate();
    const primary = new Error('SYNTHETIC_FIRST'); const close = new Error('SYNTHETIC_READ_CLOSE');
    const notify = new Error('SYNTHETIC_NOTIFICATION');
    const read = f.registry.inspectSlots.bind(f.registry);
    let inject = false; let stale = false; let finalized = false;
    const binding = new WorkspaceBackupImportBinding({ ...f.options,
      mainOwner: { assertCurrent() { if (stale) throw primary; }, assertOwned: f.assertOwned },
      registry: { writeSelected: f.registry.writeSelected.bind(f.registry), async inspectSlots(guard) {
        if (!inject) return read(guard);
        stale = true;
        try { guard?.(); } finally { entered.resolve(); await finish.promise; finalized = true; throw close; }
      } } }, f.fileSystem);
    f.onUncertain.mockImplementation(() => { throw notify; });
    await binding.publish(); inject = true;
    const pending = binding.assertPublished().then(() => undefined, error => error as unknown);
    let result: unknown;
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('READER_NOT_ENTERED'); })]);
      expect(finalized).toBe(false);
      stale = false;
      await expect(binding.assertPublished()).rejects.toMatchObject({ cause: { errors: [primary, notify] } });
    } finally { finish.resolve(); result = await pending; }
    expect(finalized).toBe(true);
    expect(result).toMatchObject({ errors: [{ errors: [primary, notify] }, close] });
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('rejects asynchronous synchronous guards without creating binding bytes', async context => {
    const f = await createImportBindingFixture(context);
    const binding = new WorkspaceBackupImportBinding({ ...f.options,
      mainOwner: { assertCurrent: async () => {}, assertOwned: f.assertOwned } }, f.fileSystem);
    await expect(binding.publish()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await readdir(f.root)).toHaveLength(1);
  });

  it('checks the original binding during every owned registry write', async context => {
    const f = await createImportBindingFixture(context);
    await f.binding.publish();
    const open = f.registryFs.createNextWriter.bind(f.registryFs);
    vi.spyOn(f.registryFs, 'createNextWriter').mockImplementationOnce(async guard => {
      const writer = await open(guard);
      await writeFile(f.paths.backupPath, await readFile(f.paths.currentPath), { flag: 'wx' });
      return writer;
    });
    await expect(f.binding.publishRegistry(f.entry, f.checkJournal)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect((await f.registry.inspectSlots()).current?.value).toEqual(f.original);
    expect((await f.registry.inspectSlots()).next?.value).toEqual(f.expected);
    const before = await snapshot(f.root);
    await expect(f.binding.assertPublished()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });
});
