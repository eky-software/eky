import { lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClosedDirectoryInventory } from './closedDirectoryInventory.mjs';
import { materializeLegacyUpgradeArtifactFixture, verifyLegacyUpgradeArtifactSourceFixture } from './legacyUpgradeArtifactFixture.mjs';
import { verifyLegacyUpgradeSemanticPostcondition } from './legacyUpgradePostcondition.mjs';
import { LEGACY_FILESYSTEM_TIMEOUT_MS } from './legacyUpgradeBudget.mjs';

export const LEGACY_FILESYSTEM_MESSAGE_MAX_BYTES = 16 * 1024 * 1024;
const PAYLOAD_KEYS = { inventory: ['root'], materialize: ['descriptorPath', 'fixtureRoot'],
  semantic: ['artifact', 'runNonce', 'runtimeRoot'], artifact: ['artifact'], remove: ['root'] };
export const LEGACY_FILESYSTEM_ERROR_CODES = Object.freeze(['WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_INVALID',
  'WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_CHANGED', 'WINDOWS_ACCEPTANCE_PROFILE_ROOT_INVALID',
  'WINDOWS_ACCEPTANCE_PROFILE_INVENTORY_FAILED', 'WINDOWS_ACCEPTANCE_PROFILE_INVENTORY_UNSTABLE',
  'WINDOWS_ACCEPTANCE_PROFILE_ENTRY_INVALID', 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_INVALID',
  'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_FAILED',
  'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_TIMED_OUT',
  'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_PROCESS_REMAINS']);

export function validateLegacyFilesystemRequest(value) {
  const exact = (object, keys) => object && Object.getPrototypeOf(object) === Object.prototype &&
    Reflect.ownKeys(object).length === keys.length && keys.every((key) =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(object, key) ?? {}, 'value'));
  if (!exact(value, ['schemaVersion', 'operation', 'payload']) || value.schemaVersion !== 1 ||
    !Object.hasOwn(LEGACY_FILESYSTEM_TIMEOUT_MS, value.operation) ||
    !exact(value.payload, PAYLOAD_KEYS[value.operation]) ||
    Buffer.byteLength(JSON.stringify(value)) > LEGACY_FILESYSTEM_MESSAGE_MAX_BYTES) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_INVALID');
  }
  return value;
}

async function requireRunRoot(root) {
  if (typeof root !== 'string' || root !== resolve(root) ||
    !/^eky-windows-acceptance-v2-legacy-[a-zA-Z0-9]{6}$/.test(basename(root))) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_INVALID');
  }
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root ||
    dirname(root) !== await realpath(tmpdir())) throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_INVALID');
}

export async function executeLegacyFilesystem(request) {
  const { operation, payload } = validateLegacyFilesystemRequest(request);
  if (operation === 'inventory') {
    if (!process.env.APPDATA || payload.root !== resolve(process.env.APPDATA, 'Eky')) {
      throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_INVALID');
    }
    return createClosedDirectoryInventory(payload.root);
  }
  const fixtureRoot = operation === 'materialize' ? payload.fixtureRoot : payload.artifact?.artifactRoot;
  const root = operation === 'remove' ? payload.root : dirname(fixtureRoot);
  await requireRunRoot(root);
  if (operation === 'remove') {
    await rm(root, { recursive: true, force: true });
    await lstat(root).then(() => { throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_FAILED'); },
      (error) => { if (error.code !== 'ENOENT') throw error; });
    return null;
  }
  if (fixtureRoot !== resolve(root, 'fixture')) throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_INVALID');
  if (operation === 'materialize') return materializeLegacyUpgradeArtifactFixture(payload.descriptorPath, fixtureRoot);
  if (operation === 'artifact') { await verifyLegacyUpgradeArtifactSourceFixture(payload.artifact); return null; }
  if (payload.runtimeRoot !== root || !/^[a-f0-9]{64}$/.test(payload.runNonce)) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_INVALID');
  }
  return verifyLegacyUpgradeSemanticPostcondition(payload);
}

// One private request/reply; no console, descendants, MSI or emergency cleanup.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (typeof process.send !== 'function' || process.argv.length !== 2) {
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
  else process.once('message', async (request) => {
    let reply;
    try {
      const value = await executeLegacyFilesystem(request);
      reply = { schemaVersion: 1, operation: request.operation, status: 'completed', value };
      if (Buffer.byteLength(JSON.stringify(reply)) > LEGACY_FILESYSTEM_MESSAGE_MAX_BYTES) throw new Error();
    } catch (error) {
      process.exitCode = 1;
      reply = { schemaVersion: 1, operation: request?.operation, status: 'failed',
        errorCode: LEGACY_FILESYSTEM_ERROR_CODES.includes(error?.message) ? error.message : 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_FAILED' };
    }
    try { process.send(reply, (error) => { if (error) process.exitCode = 1; if (process.connected) process.disconnect(); }); }
    catch { process.exitCode = 1; if (process.connected) process.disconnect(); }
  });
}
