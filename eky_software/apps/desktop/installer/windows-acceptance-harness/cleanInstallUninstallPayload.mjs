import { lstat, realpath, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';

export async function verifyCleanInstalledPayload(root, expected) {
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('cleanPayloadInvalid');
  const actual = await inspectPackageArtifactInventory({ root, stage: 'packagedApp' });
  if (actual.identity !== expected.identity || actual.fileCount !== expected.fileCount ||
    actual.totalByteSize !== expected.totalByteSize || expected.stage !== actual.stage) {
    throw new Error('cleanPayloadInvalid');
  }
}

// Only this release-owned leaf may be damaged, after the entire installed tree is verified.
export async function damageCleanRepairPayload(root, expected) {
  await verifyCleanInstalledPayload(root, expected);
  const canonicalRoot = await realpath(root);
  const path = resolve(canonicalRoot, 'resources', 'backend', 'dist', 'index.js');
  if (await realpath(path) !== path) throw new Error('cleanRepairPreparationFailed');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error('cleanRepairPreparationFailed');
  }
  await unlink(path);
  await lstat(path).then(() => { throw new Error('cleanRepairPreparationFailed'); }, (error) => {
    if (error.code !== 'ENOENT') throw new Error('cleanRepairPreparationFailed');
  });
}
