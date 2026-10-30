import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { captureWorkspaceRemnantBinding, maximumWorkspaceRemnantBindingBytes,
  serializeWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WorkspaceLegacyAdoptionBindingSelection } from './workspaceLegacyAdoptionBindingSelection.js';
import { createAdoptionJournal, TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID } from './workspaceLegacyAdoptionTestSupport.js';

const profileId = 'c'.repeat(64);

describe('adoption binding selection and acknowledgement', () => {
  it('publishes once from observed absence and retains original provenance after a new selection', async context => {
    const f = await fixture(context);
    const before = await f.snapshot();
    const selected = await f.capture();
    expect(await f.snapshot()).toEqual(before);
    expect(selected.initialBinding).toBeUndefined();
    const writer = vi.spyOn(f.fs, 'createNextWriter');
    await selected.publish(profileId);
    await selected.publish(profileId);
    await selected.assertPublished(profileId);
    expect(writer).toHaveBeenCalledOnce();
    expect(selected.initialBinding).toBeUndefined();
    expect(await readFile(f.paths.currentPath)).toEqual(f.bytes);
    const successor = await f.capture();
    expect(successor.initialBinding).toEqual(f.binding);
    await successor.assertPublished(profileId);
    expect(await f.payloads()).toEqual(f.originalPayloads);
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('accepts the existing strict-reader combination without rewriting or deleting slots', async context => {
    const f = await fixture(context);
    await f.prepare();
    await writeFile(f.paths.currentPath, f.bytes);
    await writeFile(f.paths.nextPath, `${JSON.stringify(f.binding, null, 2)}\n`);
    await writeFile(f.paths.backupPath, f.bytes);
    const before = await f.snapshot();
    const selected = await f.capture();
    const writer = vi.spyOn(f.fs, 'createNextWriter');
    await selected.publish(profileId);
    await selected.assertPublished(profileId);
    expect(writer).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
    expect(selected.initialBinding).toEqual(f.binding);
  });

  it('does not create a legacy binding for fresh installation', async context => {
    const f = await fixture(context, 'fresh');
    const selected = await f.capture();
    const before = await f.snapshot();
    await expect(selected.publish(profileId)).rejects.toThrow();
    await selected.assertCurrent();
    expect(await f.snapshot()).toEqual(before);
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('retains a legacy binding conflicting with a fresh journal', async context => {
    const f = await fixture(context, 'fresh');
    await f.publishExisting();
    const before = await f.snapshot();
    await expect(f.capture()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });

  it.for(['nextOnly', 'backupOnly', 'tornSide', 'wrongOperation', 'wrongWorkspace', 'wrongOwner', 'conflictingLineage'] as const)(
    'rejects initial %s without repairing or inventing a binding', async (fault, context) => {
      const f = await fixture(context);
      await f.prepare();
      if (fault === 'nextOnly') await writeFile(f.paths.nextPath, f.bytes);
      else if (fault === 'backupOnly') await writeFile(f.paths.backupPath, f.bytes);
      else {
        const value = fault === 'wrongOperation' ? { ...f.binding, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
          : fault === 'wrongWorkspace' ? { ...f.binding, workspaceId: '22222222-2222-4222-8222-222222222222' }
          : fault === 'wrongOwner' ? { ...f.binding, owner: 'workspaceImport' } : f.binding;
        await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding(value)));
        if (fault === 'tornSide') await writeFile(f.paths.nextPath, '{torn\n');
        if (fault === 'conflictingLineage') await writeFile(f.paths.backupPath, serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({
          ...f.binding, lineageIdentity: { formatVersion: 1, profileId: 'd'.repeat(64) },
        })));
      }
      const before = await f.snapshot();
      await expect(f.capture()).rejects.toThrow();
      expect(await f.snapshot()).toEqual(before);
      expect(f.onUncertain).toHaveBeenCalledOnce();
    });

  it('does not change existing lineage when the healthy runtime reports a different profile', async context => {
    const f = await fixture(context);
    await f.publishExisting();
    const selected = await f.capture();
    const before = await f.snapshot();
    await expect(selected.publish('d'.repeat(64))).rejects.toThrow();
    await expect(selected.assertPublished(profileId)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('does not adopt an exact-looking publication that appeared after the original absence', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    await f.publishExisting();
    const before = await f.snapshot();
    await expect(selected.publish(profileId)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });

  it.for(['identity', 'current', 'next', 'backup', 'disappearance'] as const)('retains changed %s instead of renewing the old choice', async (change, context) => {
    const f = await fixture(context);
    await f.publishExisting();
    const selected = await f.capture();
    if (change === 'identity') {
      await rename(f.paths.currentPath, `${f.paths.currentPath}.preserved`);
      await writeFile(f.paths.currentPath, f.bytes, { flag: 'wx' });
    } else if (change === 'disappearance') await rm(f.paths.currentPath);
    else await writeFile(f.paths[`${change}Path`], change === 'current' ? `${JSON.stringify(f.binding, null, 2)}\n` : f.bytes);
    const before = await f.snapshot();
    await expect(selected.assertPublished(profileId)).rejects.toThrow();
    await expect(selected.publish(profileId)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(['beforePublish', 'afterPublish', 'directorySync', 'writerSync', 'writerClose'] as const)(
    'retains a lost %s acknowledgement without automatic promotion or retry', async (fault, context) => {
      const f = await fixture(context);
      const selected = await f.capture();
      const first = new Error(`synthetic ${fault} failure`);
      const move = f.fs.moveSlot.bind(f.fs);
      const moveSpy = vi.spyOn(f.fs, 'moveSlot').mockImplementation(async (...args) => {
        if (fault === 'beforePublish') throw first;
        await move(...args);
        if (fault === 'afterPublish') throw first;
      });
      const sync = f.fs.syncDirectory.bind(f.fs);
      const syncSpy = vi.spyOn(f.fs, 'syncDirectory').mockImplementation(async guard => { await sync(guard); if (fault === 'directorySync') throw first; });
      const create = f.fs.createNextWriter.bind(f.fs);
      const writerSpy = vi.spyOn(f.fs, 'createNextWriter').mockImplementation(async guard => {
        const writer = await create(guard);
        return { write: writer.write.bind(writer), readIdentity: writer.readIdentity!.bind(writer),
          async sync() { await writer.sync(); if (fault === 'writerSync') throw first; },
          async close() { await writer.close(); if (fault === 'writerClose') throw first; } };
      });
      await expect(selected.publish(profileId)).rejects.toMatchObject({ cause: first });
      expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
      const before = await f.snapshot();
      moveSpy.mockRestore(); syncSpy.mockRestore(); writerSpy.mockRestore();
      await expect(selected.publish(profileId)).rejects.toMatchObject({ cause: first });
      expect(await f.snapshot()).toEqual(before);
      if (fault === 'afterPublish' || fault === 'directorySync') {
        const successor = await f.capture();
        await successor.assertPublished(profileId);
      } else await expect(f.capture()).rejects.toThrow();
      expect(await f.snapshot()).toEqual(before);
      expect(await f.payloads()).toEqual(f.originalPayloads);
    });

  it('joins a delayed failing writer close and preserves the first cause separately', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const first = new Error('synthetic write sync failure'), closing = new Error('synthetic closing failure');
    const entered = gate(), release = gate();
    const create = f.fs.createNextWriter.bind(f.fs);
    vi.spyOn(f.fs, 'createNextWriter').mockImplementation(async guard => {
      const writer = await create(guard);
      return { write: writer.write.bind(writer), readIdentity: writer.readIdentity!.bind(writer),
        sync: async () => { throw first; }, async close() {
          entered.resolve(); await release.promise; await writer.close(); throw closing;
        } };
    });
    let settled = false;
    const operation = selected.publish(profileId).finally(() => { settled = true; });
    const observed = operation.catch(error => error);
    try { await entered.promise; expect(settled).toBe(false); expect(f.onUncertain).not.toHaveBeenCalled(); }
    finally { release.resolve(); await observed; }
    await expect(operation).rejects.toMatchObject({ cause: { errors: [first, closing] } });
    expect(await readFile(f.paths.nextPath)).toEqual(f.bytes);
    expect(await f.payloads()).toEqual(f.originalPayloads);
  });

  it.for(['identityReplaced', 'wrongReceiptIdentity', 'wrongReceiptValue'] as const)(
    'rejects %s at publication readback without adopting or deleting the published bytes', async (fault, context) => {
      const f = await fixture(context);
      const selected = await f.capture();
      const publish = WorkspaceRemnantBindingStore.prototype.publish;
      const spy = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceRemnantBindingStore, ...args) {
        const receipt = await publish.apply(this, args);
        if (fault === 'identityReplaced') {
          await rename(f.paths.currentPath, `${f.paths.currentPath}.preserved`);
          await writeFile(f.paths.currentPath, f.bytes, { flag: 'wx' });
        }
        const differentInode = receipt.identity.ino === 1 ? 2 : 1;
        expect(differentInode).not.toBe(receipt.identity.ino);
        return fault === 'wrongReceiptIdentity' ? { ...receipt, identity: { ...receipt.identity, ino: differentInode } }
          : fault === 'wrongReceiptValue' ? { ...receipt, value: captureWorkspaceRemnantBinding({ ...receipt.value,
            lineageIdentity: { formatVersion: 1, profileId: 'd'.repeat(64) } }) } : receipt;
      });
      try { await expect(selected.publish(profileId)).rejects.toThrow(); }
      finally { spy.mockRestore(); }
      expect(await readFile(f.paths.currentPath)).toEqual(f.bytes);
      if (fault === 'identityReplaced') expect(await readFile(`${f.paths.currentPath}.preserved`)).toEqual(f.bytes);
      expect(await f.payloads()).toEqual(f.originalPayloads);
      expect(f.onUncertain).toHaveBeenCalledOnce();
    });

  it('rejects an asynchronous replacement for the synchronous guard before reading files', async context => {
    const f = await fixture(context);
    const read = vi.spyOn(f.fs, 'readSlot');
    await expect(WorkspaceLegacyAdoptionBindingSelection.capture({ userDataRoot: f.root, journal: f.journal,
      ...f.authority, assertAuthority: async () => {} }, f.fs)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('refuses a second request and joins the already-started inspection', async context => {
    const f = await fixture(context);
    await f.publishExisting();
    const selected = await f.capture();
    const entered = gate(), release = gate();
    const read = f.fs.readSlot.bind(f.fs);
    vi.spyOn(f.fs, 'readSlot').mockImplementationOnce(async (...args) => {
      const result = await read(...args); entered.resolve(); await release.promise; return result;
    });
    const writer = vi.spyOn(f.fs, 'createNextWriter');
    let settled = false;
    const operation = selected.assertCurrent().finally(() => { settled = true; });
    const observed = operation.catch(error => error);
    try {
      await entered.promise;
      await expect(selected.publish(profileId)).rejects.toThrow();
      expect(settled).toBe(false);
    } finally { release.resolve(); await observed; }
    await expect(operation).rejects.toThrow();
    expect(writer).not.toHaveBeenCalled();
    expect(await readFile(f.paths.currentPath)).toEqual(f.bytes);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('rejects uncertainty delivered in the last completion continuation', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const view = selected as unknown as { readBindingOnly(): Promise<unknown> };
    const read = view.readBindingOnly.bind(view);
    const first = new Error('synthetic final owner invalidation');
    let reads = 0;
    const spy = vi.spyOn(view, 'readBindingOnly').mockImplementation(async () => {
      const actual = await read();
      if (++reads === 2) queueMicrotask(() => selected.onUncertain(first));
      return actual;
    });
    try { await expect(selected.assertCurrent()).rejects.toMatchObject({ cause: first }); }
    finally { spy.mockRestore(); }
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    expect(await f.snapshot()).toEqual({ current: undefined, next: undefined, backup: undefined });
  });

  it('preserves closing failure after ownership expiry already recorded the first cause', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const closing = new Error('synthetic close failure after owner loss');
    const create = f.fs.createNextWriter.bind(f.fs);
    vi.spyOn(f.fs, 'createNextWriter').mockImplementation(async guard => {
      const writer = await create(guard);
      return { write: writer.write.bind(writer), readIdentity: writer.readIdentity!.bind(writer),
        async sync() { await writer.sync(); f.state.current = false; },
        async close() { await writer.close(); throw closing; } };
    });
    const result = await selected.publish(profileId).catch(error => error);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(result.cause).toBeInstanceOf(AggregateError);
    expect(result.cause.errors).toEqual([f.onUncertain.mock.calls[0]![0], closing]);
    expect(await readFile(f.paths.nextPath)).toEqual(f.bytes);
    expect(await f.payloads()).toEqual(f.originalPayloads);
  });

  it.for(['before', 'external', 'nativeGuard'] as const)('rejects expired authority at %s and never renews the same selection', async (stage, context) => {
    const f = await fixture(context);
    const selected = await f.capture();
    if (stage === 'before') f.state.current = false;
    else if (stage === 'external') f.external.mockImplementationOnce(async () => { f.state.current = false; });
    else {
      const create = f.fs.createNextWriter.bind(f.fs);
      vi.spyOn(f.fs, 'createNextWriter').mockImplementationOnce(async guard => { f.state.current = false; return create(guard); });
    }
    const before = await f.snapshot();
    await expect(selected.publish(profileId)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    f.state.current = true;
    await expect(selected.assertCurrent()).rejects.toThrow();
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('rechecks the exact binding after the final external continuation', async context => {
    const f = await fixture(context);
    await f.publishExisting();
    const selected = await f.capture();
    let calls = 0;
    f.external.mockImplementation(async () => { if (++calls === 2) await writeFile(f.paths.nextPath, f.bytes, { flag: 'wx' }); });
    await expect(selected.assertCurrent()).rejects.toThrow();
    expect(await readFile(f.paths.nextPath)).toEqual(f.bytes);
    expect(await readFile(f.paths.currentPath)).toEqual(f.bytes);
  });

  it('keeps the original external failure when notification also fails', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const first = new Error('synthetic metadata selection lost');
    f.external.mockRejectedValueOnce(first);
    f.onUncertain.mockImplementationOnce(() => { throw new Error('synthetic observer failure'); });
    await expect(selected.publish(profileId)).rejects.toMatchObject({ cause: first });
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    expect(await f.snapshot()).toEqual({ current: undefined, next: undefined, backup: undefined });
  });
});

async function fixture(context: TestContext, kind: 'legacy' | 'fresh' = 'legacy') {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-binding-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const journal = createAdoptionJournal('rootPublished', kind);
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceLegacyAdoption',
    operationId: TEST_ADOPTION_OPERATION_ID, workspaceId: TEST_ADOPTION_WORKSPACE_ID,
    lineageIdentity: { formatVersion: 1, profileId } });
  const bytes = serializeWorkspaceRemnantBinding(binding);
  const paths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceLegacyAdoption', workspaceId: TEST_ADOPTION_WORKSPACE_ID });
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes);
  const state = { current: true };
  const external = vi.fn(async () => {}), onUncertain = vi.fn((_error: unknown) => {});
  const authority = { assertAuthority() { if (!state.current) throw new Error('synthetic adoption owner lost'); },
    assertExternalSelection: external, onUncertain };
  const capture = () => WorkspaceLegacyAdoptionBindingSelection.capture({ userDataRoot: root, journal, ...authority }, fs);
  const prepare = () => mkdir(paths.directoryPath, { recursive: true, mode: 0o700 });
  const publishExisting = () => new WorkspaceRemnantBindingStore(root, { owner: 'workspaceLegacyAdoption', workspaceId: TEST_ADOPTION_WORKSPACE_ID }, fs)
    .publish(binding, { assertAuthority() {}, async assertExternalSelection() {} });
  const source = join(root, 'runtime', 'data', 'eky.sqlite');
  const final = join(root, 'workspaces', TEST_ADOPTION_WORKSPACE_ID, 'runtime', 'data', 'eky.sqlite');
  const other = join(root, 'other-company.txt');
  for (const path of [source, final]) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, 'synthetic database'); }
  await writeFile(other, 'other workspace');
  const payloads = async () => ({ source: await readFile(source), final: await readFile(final), other: await readFile(other) });
  const originalPayloads = await payloads();
  const snapshot = async () => ({ current: await fileBytes(paths.currentPath), next: await fileBytes(paths.nextPath), backup: await fileBytes(paths.backupPath) });
  return { root, journal, binding, bytes, paths, fs, state, external, onUncertain, authority,
    capture, prepare, publishExisting, payloads, originalPayloads, snapshot };
}

async function fileBytes(path: string) {
  try { return await readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
