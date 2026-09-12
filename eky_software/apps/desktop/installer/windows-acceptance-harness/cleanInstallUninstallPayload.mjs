import { lstat, realpath, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { verifyInstalledPackagePayload } from './installedPackagePayload.mjs';

export async function verifyCleanInstalledPayload(root, expected) {
  try { await verifyInstalledPackagePayload(root, expected); }
  catch { throw new Error('cleanPayloadInvalid'); }
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
