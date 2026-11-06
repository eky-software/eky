import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { captureDeletionInventoryRecord, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id,
  deletionTestJournal as journal, deletionTestRecord as record } from './workspaceDeletionDataTestSupport.js';
import { deletionInventoryStoreFixture as fixture } from './workspaceDeletionInventoryStoreTestSupport.js';
import { retireWorkspaceDeletionInventory } from './workspaceDeletionInventoryRetirement.js';
import { workspaceDeletionInventoryFileName as fileName } from './workspaceDeletionInventoryStore.js';

function evidence(value = 1) {
  return captureDeletionInventoryRecord({ ...record(value), role: 'inspectionEvidence', generationId: id(value + 1_000) });
}
function workspace() {
  return captureDeletionInventoryRecord({ ...record(), role: 'workspace', ownerOperationId: null, bindingSha256: null });
}
async function* source(values: readonly WorkspaceDeletionInventoryRecord[] = [evidence(), workspace()]) { yield* values; }

it('publishes evidence through the real store and validates it with a new reader without touching payloads', async context => {
  const f = await fixture(context);
  const other = join(f.root, 'other-company');
  await writeFile(other, 'retained-other-company', { mode: 0o600 });
  const selected = await f.store().publish(header, source(), f.authority);
  const bytes = await readFile(f.paths.currentPath);
  expect(bytes.toString('utf8')).toContain('"role":"inspectionEvidence"');
  expect(selected.target.formatVersion).toBe(2);
  expect(selected.inventory.formatVersion).toBe(2);
  expect(await f.store().inspect(selected, f.authority)).toEqual(selected.inventory);
  expect(await readFile(other, 'utf8')).toBe('retained-other-company');
  expect((await readFile(f.paths.currentPath)).equals(bytes)).toBe(true);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it('does not publish a semantically conflicting inventory and retains its next bytes', async context => {
  const f = await fixture(context);
  const external = captureDeletionInventoryRecord({ ...evidence(), role: 'inspection' });
  await expect(f.store().publish(header, source([external, evidence(), workspace()]), f.authority))
    .rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(await readdir(f.paths.directoryPath)).toEqual([`${fileName}.next`]);
  expect((await readFile(f.paths.nextPath, 'utf8')).trimEnd().split('\n')).toHaveLength(4);
  expect(f.handles.closed).toBe(f.handles.opened);
});

it.for(['lease', 'target', 'bytes', 'close'] as const)('rejects %s failure during a semantic reread and joins close', async (change, context) => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, source(), f.authority);
  const before = await readFile(f.paths.currentPath);
  let starts = 0;
  let changed = false;
  const first = new Error('SYNTHETIC_SEMANTIC_READ');
  const last = new Error('SYNTHETIC_SEMANTIC_CLOSE');
  const store = f.store(async (...args) => {
    const file = await f.trackedOpen(...args);
    return { ...file,
      async read(bytes, position) {
        const count = await file.read(bytes, position);
        if (position === 0) starts++;
        if (starts === 2 && !changed) {
          changed = true;
          if (change === 'lease') f.expire();
          if (change === 'target') f.changeTarget();
          if (change === 'bytes') await writeFile(f.paths.currentPath,
            before.toString().replace(hash('root-1'), hash('changed')));
          if (change === 'close') throw first;
        }
        return count;
      },
      async close() { await file.close(); if (change === 'close' && changed) throw last; },
    };
  });
  if (change === 'close') await expect(store.inspect(selected, f.authority)).rejects.toMatchObject({ errors: [first, last] });
  else await expect(store.inspect(selected, f.authority)).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.handles.closed).toBe(f.handles.opened);
  expect(await readdir(f.paths.directoryPath)).toEqual([fileName]);
  if (change !== 'bytes') expect((await readFile(f.paths.currentPath)).equals(before)).toBe(true);
});

it('preserves a v1 inventory and rejects v1 retirement even when its supplied versions agree', async context => {
  const f = await fixture(context);
  const selected = await f.store().publish(header, source(), f.authority);
  const current = await readFile(f.paths.currentPath, 'utf8');
  const legacy = current.replace('"formatVersion":2', '"formatVersion":1');
  await writeFile(f.paths.currentPath, legacy);
  const v1 = { ...selected, target: { ...selected.target, formatVersion: 1 },
    inventory: { ...selected.inventory, formatVersion: 1 } };
  await expect(f.store().inspect(v1, f.authority)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  await expect(retireWorkspaceDeletionInventory(f.root, { ...journal('registryPublished'), ...v1 }, f.authority))
    .rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.paths.currentPath, 'utf8')).toBe(legacy);
  expect(await readdir(f.paths.directoryPath)).toEqual([fileName]);
  expect(f.handles.closed).toBe(f.handles.opened);
});
