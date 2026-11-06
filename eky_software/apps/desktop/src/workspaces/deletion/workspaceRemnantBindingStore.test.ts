import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';
import { remnantBindingFixture as fixture, remnantBindingTestOwners as owners } from './workspaceRemnantBindingTestSupport.js';

for (const owner of owners) {
  it(`publishes immutable ${owner} bytes, reads after restart and clears only metadata`, async context => {
    const f = await fixture(context, owner);
    const other = join(f.root, 'other-company');
    await writeFile(other, 'preserved');
    expect((await f.store().inspect(f.authority)).mode).toBe('absent');
    const receipt = await f.store().publish(f.binding, f.authority);
    expect(receipt.identity.ino).not.toBe(0);
    const result = await f.store().inspect(f.authority);
    expect(result).toMatchObject({ mode: 'published', value: f.binding, bindingSha256: receipt.bindingSha256 });
    expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
    await expect(f.store().publish(f.binding, f.authority)).rejects.toThrow();
    await f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup());
    expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
    expect((await f.store().inspect(f.authority)).mode).toBe('absent');
    expect(await readFile(other, 'utf8')).toBe('preserved');
  });
}

it('normalizes formatting only for value comparison while preserving actual source bytes', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const formatted = `${JSON.stringify(Object.fromEntries(Object.entries(f.binding).reverse()), null, 2)}\n`;
  await writeFile(f.paths.nextPath, formatted, { flag: 'wx', mode: 0o600 });
  await writeFile(f.paths.backupPath, serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
  const before = await f.snapshot();
  expect((await f.store().inspect(f.authority)).mode).toBe('published');
  expect(await f.snapshot()).toEqual(before);
  await f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup());
  expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
});

for (const slot of ['next', 'backup'] as const) {
  it(`refuses ordinary ${slot}-only but permits explicitly admitted deletion-purged metadata cleanup`, async context => {
    const f = await fixture(context);
    await f.prepare();
    await writeFile(slot === 'next' ? f.paths.nextPath : f.paths.backupPath,
      serializeWorkspaceRemnantBinding(f.binding), { flag: 'wx', mode: 0o600 });
    const before = await f.snapshot();
    await expect(f.store().inspect(f.authority)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.snapshot()).toEqual(before);
    await f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'));
    expect(await readdir(f.paths.directoryPath)).toHaveLength(0);
  });
}

for (const variant of ['foreignWorkspace', 'foreignOwner', 'foreignLineage', 'badJson', 'duplicateKey'] as const) {
  it(`preserves all slots on ${variant}`, async context => {
    const f = await fixture(context);
    await f.store().publish(f.binding, f.authority);
    const foreign = variant === 'foreignWorkspace' ? captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(8) })
      : variant === 'foreignOwner' ? captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceImport' })
      : variant === 'foreignLineage' ? captureWorkspaceRemnantBinding({ ...f.binding, lineageIdentity: { ...f.binding.lineageIdentity, profileId: 'f'.repeat(64) } })
      : f.binding;
    const bytes = variant === 'badJson' ? Buffer.from('{broken\n')
      : variant === 'duplicateKey' ? Buffer.from(serializeWorkspaceRemnantBinding(f.binding).toString().replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1'))
      : serializeWorkspaceRemnantBinding(foreign);
    await writeFile(f.paths.backupPath, bytes, { flag: 'wx', mode: 0o600 });
    const before = await f.snapshot();
    await expect(f.store().inspect(f.authority)).rejects.toThrow();
    await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'))).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });
}

for (const fault of ['beforeWrite', 'afterWrite', 'sync', 'close', 'beforePublish', 'afterPublish', 'directorySync'] as const) {
  it(`retains actual initial publication state for ${fault} without promotion or retry`, async context => {
    const f = await fixture(context);
    const first = new Error(`SYNTHETIC_${fault}`);
    const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
    let closed = false;
    f.fileSystem.createNextWriter = async guard => {
      const writer = await open(guard);
      return { readIdentity: () => writer.readIdentity!(),
        async write(bytes) {
          if (fault === 'beforeWrite') throw first;
          const count = await writer.write(bytes);
          if (fault === 'afterWrite') throw first;
          return count;
        },
        async sync() { await writer.sync(); if (fault === 'sync') throw first; },
        async close() { await writer.close(); closed = true; if (fault === 'close') throw first; },
      };
    };
    const move = f.fileSystem.moveSlot.bind(f.fileSystem);
    f.fileSystem.moveSlot = async (...args) => {
      if (fault === 'beforePublish') throw first;
      await move(...args);
      if (fault === 'afterPublish') throw first;
    };
    const sync = f.fileSystem.syncDirectory.bind(f.fileSystem);
    f.fileSystem.syncDirectory = async (...args) => { await sync(...args); if (fault === 'directorySync') throw first; };
    await expect(f.store().publish(f.binding, f.authority)).rejects.toBe(first);
    expect(closed).toBe(true);
    const published = fault === 'afterPublish' || fault === 'directorySync';
    expect(await readdir(f.paths.directoryPath)).toEqual([`${id(1)}.json${published ? '' : '.next'}`]);
    if (published) expect((await f.store().inspect(f.authority)).mode).toBe('published');
    else await expect(f.store().inspect(f.authority)).rejects.toThrow();
    const before = await f.snapshot();
    await expect(f.store().publish(f.binding, f.authority)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });
}

it('joins a later close failure without replacing the original write failure', async context => {
  const f = await fixture(context);
  const first = new Error('SYNTHETIC_WRITE');
  const later = new Error('SYNTHETIC_CLOSE');
  const open = f.fileSystem.createNextWriter.bind(f.fileSystem);
  f.fileSystem.createNextWriter = async guard => {
    const writer = await open(guard);
    return { readIdentity: () => writer.readIdentity!(), async write() { throw first; }, sync: () => writer.sync(),
      async close() { await writer.close(); throw later; } };
  };
  await expect(f.store().publish(f.binding, f.authority)).rejects.toMatchObject({ errors: [first, later] });
  expect(await readdir(f.paths.directoryPath)).toEqual([`${id(1)}.json.next`]);
});

for (const loss of ['lease', 'target', 'payload'] as const) {
  it(`preserves binding on ${loss} loss before cleanup`, async context => {
    const f = await fixture(context);
    await f.store().publish(f.binding, f.authority);
    const before = await f.snapshot();
    if (loss === 'lease') f.expire();
    if (loss === 'target') f.changeTarget();
    if (loss === 'payload') f.payloadRemains();
    await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup())).rejects.toThrow(
      loss === 'lease' ? 'SYNTHETIC_LEASE_LOST' : loss === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_PAYLOAD_REMAINS');
    expect(await f.snapshot()).toEqual(before);
  });
}

it('refuses a foreign immutable value or hash even when the address matches', async context => {
  const f = await fixture(context);
  await f.store().publish(f.binding, f.authority);
  const before = await f.snapshot();
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, { ...f.cleanup(), bindingSha256: 'f'.repeat(64) })).rejects.toThrow();
  await expect(f.store().clearAfterPayloadsAbsent(captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(9) }), f.cleanup())).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('does not acknowledge metadata absence while any payload remains', async context => {
  const f = await fixture(context);
  f.payloadRemains();
  await expect(f.store().clearAfterPayloadsAbsent(f.binding, f.cleanup('deletionPurged'))).rejects.toThrow('SYNTHETIC_PAYLOAD_REMAINS');
  expect(await readdir(f.root)).toHaveLength(0);
});

it('rejects asynchronous lease assertions before creating files', async context => {
  const f = await fixture(context);
  await expect(f.store().publish(f.binding, { ...f.authority, assertAuthority: async () => {} })).rejects.toThrow();
  expect(await readdir(f.root)).toHaveLength(0);
});
