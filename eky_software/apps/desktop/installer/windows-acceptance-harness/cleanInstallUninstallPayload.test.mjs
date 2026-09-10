import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import { damageCleanRepairPayload, verifyCleanInstalledPayload } from './cleanInstallUninstallPayload.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eky-clean-payload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = join(root, 'payload');
  const leaf = join(payload, 'resources', 'backend', 'dist', 'index.js');
  await mkdir(join(payload, 'resources', 'backend', 'dist'), { recursive: true });
  await writeFile(leaf, 'synthetic backend');
  await writeFile(join(payload, 'Eky.exe'), 'synthetic executable');
  const expected = await inspectPackageArtifactInventory({ root: payload, stage: 'packagedApp' });
  return { root, payload, leaf, expected };
}

test('repair removes only the verified release leaf and requires exact restored payload', async (t) => {
  const { payload, leaf, expected } = await fixture(t);
  await verifyCleanInstalledPayload(payload, expected);
  await damageCleanRepairPayload(payload, expected);
  await assert.rejects(readFile(leaf), { code: 'ENOENT' });
  assert.equal(await readFile(join(payload, 'Eky.exe'), 'utf8'), 'synthetic executable');
  await assert.rejects(verifyCleanInstalledPayload(payload, expected));
  await writeFile(leaf, 'wrong contents');
  await assert.rejects(verifyCleanInstalledPayload(payload, expected));
  await writeFile(leaf, 'synthetic backend');
  await verifyCleanInstalledPayload(payload, expected);
  await writeFile(join(payload, 'unexpected.txt'), 'extra');
  await assert.rejects(verifyCleanInstalledPayload(payload, expected));
});

test('repair refuses changed or linked trees without deleting the target or foreign bytes', async (t) => {
  for (const mode of ['changed', 'hardlink', 'symlink']) {
    const { root, payload, leaf, expected } = await fixture(t);
    const foreign = join(root, 'foreign');
    if (mode === 'changed') await writeFile(leaf, 'changed');
    if (mode === 'hardlink') await link(leaf, foreign);
    if (mode === 'symlink') await symlink(join(payload, 'resources'), foreign, 'junction');
    const target = mode === 'symlink' ? foreign : payload;
    await assert.rejects(damageCleanRepairPayload(target, expected));
    assert.equal(await readFile(leaf, 'utf8'), mode === 'changed' ? 'changed' : 'synthetic backend');
  }
});
