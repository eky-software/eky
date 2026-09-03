import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createClosedDirectoryInventory,
  inventoriesMatch,
} from './closedDirectoryInventory.mjs';

async function temporaryRoot(testContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-inventory-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

test('a missing profile has an empty in-memory inventory', async (testContext) => {
  const root = await temporaryRoot(testContext);
  assert.deepEqual(
    await createClosedDirectoryInventory(join(root, 'missing')),
    [],
  );
});

test('profile inventories include directory names and file bytes deterministically', async (testContext) => {
  const root = await temporaryRoot(testContext);
  const profileRoot = join(root, 'profile');
  await mkdir(join(profileRoot, 'nested'), { recursive: true });
  await writeFile(join(profileRoot, 'b.txt'), 'beta');
  await writeFile(join(profileRoot, 'nested', 'a.txt'), 'alpha');

  const first = await createClosedDirectoryInventory(profileRoot);
  const second = await createClosedDirectoryInventory(profileRoot);
  assert.equal(inventoriesMatch(first, second), true);
  assert.deepEqual(
    first.map(({ kind, relativePath }) => ({ kind, relativePath })),
    [
      { kind: 'file', relativePath: 'b.txt' },
      { kind: 'directory', relativePath: 'nested' },
      { kind: 'file', relativePath: 'nested/a.txt' },
    ],
  );

  await writeFile(join(profileRoot, 'b.txt'), 'BETa');
  const changed = await createClosedDirectoryInventory(profileRoot);
  assert.equal(inventoriesMatch(first, changed), false);
});

test('profile inventory rejects hardlinked files at the read boundary', async (testContext) => {
  const root = await temporaryRoot(testContext);
  const profileRoot = join(root, 'profile');
  await mkdir(profileRoot);
  const source = join(root, 'source.txt');
  await writeFile(source, 'outside bytes');
  await link(source, join(profileRoot, 'linked.txt'));

  await assert.rejects(
    createClosedDirectoryInventory(profileRoot),
    /WINDOWS_ACCEPTANCE_PROFILE_ENTRY_INVALID/,
  );
});
