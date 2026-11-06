import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { serializeWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';
import { remnantBindingFixture as fixture } from './workspaceRemnantBindingTestSupport.js';

for (const sides of [[], ['next'], ['backup'], ['next', 'backup']] as const) {
  it(`clears exactly the cold-observed binding with sides ${sides.join('+')}`, async context => {
    const f = await fixture(context, 'workspaceImport');
    await f.store().publish(f.binding, f.authority);
    for (const side of sides) await writeFile(f.paths[`${side}Path`], serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
    const observed = await f.store().inspect(f.authority);
    await f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup(), expectedOwnerSlots: observed.slots });
    expect(await readdir(f.paths.directoryPath)).toEqual([]);
  });
}

it.for(['current', 'next', 'backup'] as const)('refuses a same-byte replaced %s binding inside clear', async (slot, context) => {
  const f = await fixture(context, 'workspaceImport');
  await f.store().publish(f.binding, f.authority);
  if (slot !== 'current') await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
  const observed = await f.store().inspect(f.authority);
  await rename(f.paths[`${slot}Path`], join(f.root, 'retained-original'));
  await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
  const before = await f.snapshot();
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup(), expectedOwnerSlots: observed.slots })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect((await readFile(join(f.root, 'retained-original'))).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});

it.for(['appeared', 'disappeared', 'reformatted'] as const)('refuses an observed sibling that %s', async (change, context) => {
  const f = await fixture(context, 'workspaceImport'); await f.store().publish(f.binding, f.authority);
  if (change !== 'appeared') await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
  const observed = await f.store().inspect(f.authority);
  if (change === 'disappeared') await rm(f.paths.nextPath);
  else await writeFile(f.paths.nextPath, change === 'reformatted' ? JSON.stringify(f.binding, null, 2) : serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  const before = await f.snapshot();
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup(), expectedOwnerSlots: observed.slots })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('does not accept the owner-only expected slots in deletion-purged mode', async context => {
  const f = await fixture(context, 'workspaceImport'); await f.store().publish(f.binding, f.authority);
  const observed = await f.store().inspect(f.authority); const before = await f.snapshot();
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup('deletionPurged'), expectedOwnerSlots: observed.slots })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('captures expected sibling bytes before an awaited external guard mutates the caller buffer', async context => {
  const f = await fixture(context, 'workspaceImport'); await f.store().publish(f.binding, f.authority);
  const observed = await f.store().inspect(f.authority);
  await f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup(), expectedOwnerSlots: observed.slots,
    async assertExternalSelection() { observed.slots.current!.bytes.fill(0); await f.authority.assertExternalSelection(); },
  });
  expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it('checks every selected slot again inside the actual low-level removal', async context => {
  const f = await fixture(context, 'workspaceImport'); await f.store().publish(f.binding, f.authority);
  const observed = await f.store().inspect(f.authority); let reached = false;
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  const spy = vi.spyOn(f.fileSystem, 'removeSlot').mockImplementation(async (slot, guard) => remove(slot, {
    assertAuthority: () => guard!.assertAuthority(),
    async beforeMutation() {
      if (!reached) {
        reached = true; await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
      }
      await guard!.beforeMutation();
    },
  }));
  try { await expect(f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup(), expectedOwnerSlots: observed.slots })).rejects.toThrow(); }
  finally { spy.mockRestore(); }
  expect(reached).toBe(true);
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
  expect((await readFile(f.paths.nextPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});
