import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';

import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { validateInstalledPayloadSummary } from './installedPackagePayload.mjs';

export const CLEAN_ARTIFACT_DESCRIPTOR_FILENAME = 'clean-install-artifact.json';
const SHA256 = /^[0-9a-f]{64}$/;
const invalid = () => new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validateWindowsAcceptanceArtifactDescriptor(value) {
  if (!exactKeys(value, ['schemaVersion', 'buildRevision', 'manifestSha256', 'payload']) ||
    value.schemaVersion !== 1 || typeof value.buildRevision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(value.buildRevision) || typeof value.manifestSha256 !== 'string' ||
    !SHA256.test(value.manifestSha256)) {
    throw invalid();
  }
  try { return Object.freeze({ ...value, payload: validateInstalledPayloadSummary(value.payload) }); }
  catch { throw invalid(); }
}

export async function readWindowsAcceptanceArtifactDescriptor(path, expectedSha256) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
    before.size < 2n || before.size > 4096n) throw invalid();
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 !== undefined && sha256 !== expectedSha256) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_IDENTITY_MISMATCH');
  }
  const descriptor = validateWindowsAcceptanceArtifactDescriptor(
    parseStrictJsonObjectBytes(bytes, { errorCode: 'WINDOWS_ACCEPTANCE_ARTIFACT_INVALID' }),
  );
  const after = await lstat(path, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n ||
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw invalid();
  return Object.freeze({ descriptor, sha256 });
}
