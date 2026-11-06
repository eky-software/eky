import { readFile, rename, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';
import type { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture as fixture } from './workspaceRemnantBindingTestSupport.js';

function inspect(f: Awaited<ReturnType<typeof fixture>>,
  extra: Partial<Parameters<WorkspaceRemnantBindingStore['inspectCommittedDeletionSlots']>[1]> = {}) {
  const target = captureDeletionInventoryHeader({ ...deletionTestJournal().target,
    workspaceId: f.binding.workspaceId, lineageIdentity: f.binding.lineageIdentity });
  return f.store().inspectCommittedDeletionSlots(target, { ...f.cleanup('deletionPurged'), ...extra });
}

for (const slot of ['current', 'next', 'backup', 'absent'] as const) {
  it(`observes committed ${slot} metadata without changing any bytes`, async context => {
    const f = await fixture(context); await f.prepare();
    if (slot !== 'absent') await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
    const before = await f.snapshot(), result = await inspect(f);
    expect(Object.keys(result).filter(key => result[key as keyof typeof result] !== undefined)).toEqual(slot === 'absent' ? [] : [slot]);
    expect(await f.snapshot()).toEqual(before);
  });
}

for (const fault of ['foreignWorkspace', 'foreignLineage', 'foreignOwner', 'badJson', 'digest', 'identity'] as const) {
  it(`rejects committed preflight ${fault} without clearing evidence`, async context => {
    const f = await fixture(context); await f.store().publish(f.binding, f.authority);
    const selected = (await f.store().inspect(f.authority)).slots;
    if (fault === 'identity') {
      await rename(f.paths.currentPath, `${f.paths.currentPath}.retained`);
      await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
    } else if (fault !== 'digest') {
      const value = fault === 'foreignWorkspace' ? { ...f.binding, workspaceId: id(8) }
        : fault === 'foreignLineage' ? { ...f.binding, lineageIdentity: { ...f.binding.lineageIdentity, profileId: 'f'.repeat(64) } }
          : { ...f.binding, owner: 'workspaceImport' };
      await writeFile(f.paths.backupPath, fault === 'badJson' ? '{broken' : serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding(value)), { flag: 'wx', mode: 0o600 });
    }
    const before = await f.snapshot();
    await expect(inspect(f, fault === 'digest' ? { bindingSha256: 'f'.repeat(64) }
      : fault === 'identity' ? { expectedDeletionSlots: selected } : {})).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });
}

it('copies the caller preflight commitment before external awaits', async context => {
  const f = await fixture(context); await f.store().publish(f.binding, f.authority);
  const selected = (await f.store().inspect(f.authority)).slots;
  const mutable = { current: { ...selected.current!, bytes: Uint8Array.from(selected.current!.bytes),
    identity: { ...selected.current!.identity! } }, next: undefined, backup: undefined };
  let once = true;
  const result = await inspect(f, { expectedDeletionSlots: mutable, async assertExternalSelection() {
    if (once) { once = false; mutable.current!.bytes.fill(0); mutable.current!.identity!.size += 1; }
    await f.authority.assertExternalSelection();
  } });
  expect(Buffer.from(result.current!.bytes)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it('does not turn a committed preflight observation into payload-absence authority', async context => {
  const f = await fixture(context); await f.store().publish(f.binding, f.authority);
  f.payloadRemains();
  const before = await f.snapshot();
  expect((await inspect(f)).current).toBeDefined();
  const target = captureDeletionInventoryHeader({ ...deletionTestJournal().target,
    workspaceId: f.binding.workspaceId, lineageIdentity: f.binding.lineageIdentity });
  await expect(f.store().inspectCommittedAfterPayloadsAbsent(target, f.cleanup('deletionPurged'))).rejects.toThrow('SYNTHETIC_PAYLOAD_REMAINS');
  expect(await f.snapshot()).toEqual(before);
});

it('joins a held preflight read after revocation before returning its failure', async context => {
  const f = await fixture(context); await f.store().publish(f.binding, f.authority);
  const read = f.fileSystem.readSlot.bind(f.fileSystem);
  let release!: () => void, entered!: () => void, once = true;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.fileSystem.readSlot = async (...args) => {
    const bytes = await read(...args);
    if (once) { once = false; entered(); await held; }
    return bytes;
  };
  let settled = false;
  const result = inspect(f).then(value => ({ value }), (error: unknown) => ({ error })).finally(() => { settled = true; });
  context.onTestFinished(async () => { release(); await result; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('PREFLIGHT_NOT_HELD'); })]);
    f.expire(); await Promise.resolve(); expect(settled).toBe(false);
  } finally { release(); }
  expect(await result).toMatchObject({ error: { message: 'SYNTHETIC_LEASE_LOST' } });
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});
