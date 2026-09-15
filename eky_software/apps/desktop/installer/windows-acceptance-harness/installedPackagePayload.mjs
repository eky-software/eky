import { lstat } from 'node:fs/promises';
import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';

export function validateInstalledPayloadSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'fileCount,identity,stage,totalByteSize' ||
    value.stage !== 'packagedApp' || !Number.isSafeInteger(value.fileCount) || value.fileCount < 1 ||
    !Number.isSafeInteger(value.totalByteSize) || value.totalByteSize < 1 ||
    typeof value.identity !== 'string' || !/^[0-9a-f]{64}$/.test(value.identity)) {
    throw new Error('installedPayloadInvalid');
  }
  return Object.freeze({ ...value });
}

export async function verifyInstalledPackagePayload(root, expected) {
  validateInstalledPayloadSummary(expected);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('installedPayloadInvalid');
  const actual = await inspectPackageArtifactInventory({ root, stage: 'packagedApp' });
  if (actual.identity !== expected.identity || actual.fileCount !== expected.fileCount ||
    actual.totalByteSize !== expected.totalByteSize) throw new Error('installedPayloadInvalid');
}
