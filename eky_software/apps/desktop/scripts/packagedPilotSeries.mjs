import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { inspectPackageArtifactInventory } from './package-artifact-inventory.mjs';
import { parsePilotArtifactManifest } from './pilot-build-gate.mjs';
import { readPackagedPilotInfo } from './readPackagedBuildInfo.mjs';
import { parseStrictJsonObjectBytes } from '../installer/windows-acceptance-harness/strictJsonObject.mjs';
import { ordinaryPath } from '../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';

export const packagedSeriesManifestVariable = 'EKY_PACKAGED_SERIES_MANIFEST_SHA256';
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(desktop, 'out/Eky-win32-x64');
const manifestPath = resolve(desktop, 'out/Eky-win32-x64.pilot-manifest.json');
const invalid = () => new Error('PACKAGED_PILOT_SERIES_INVALID');
const fingerprint = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];

export function requirePackagedSeriesPin(environment = process.env) {
  const pin = environment[packagedSeriesManifestVariable];
  if (typeof pin !== 'string' || !/^[a-f0-9]{64}$/u.test(pin)) throw invalid();
  return pin;
}

// Test evidence only. This identity never authorizes profile mutations.
export async function inspectPackagedPilotSeries(expectedPin, {
  assertCurrent = () => {},
  inspectInventory = inspectPackageArtifactInventory,
  readInfo = readPackagedPilotInfo,
  readManifest = readManifestBytes,
} = {}) {
  if (expectedPin !== undefined) requirePackagedSeriesPin({ [packagedSeriesManifestVariable]: expectedPin });
  assertCurrent();
  const before = await readManifest(); assertCurrent();
  const pin = createHash('sha256').update(before).digest('hex');
  if (expectedPin !== undefined && pin !== expectedPin) throw invalid();
  const info = await readInfo(packageRoot); assertCurrent();
  const inventory = await inspectInventory({ root: packageRoot, stage: 'packagedApp' }); assertCurrent();
  const manifest = parsePilotArtifactManifest(parseStrictJsonObjectBytes(before, {
    errorCode: 'PACKAGED_PILOT_SERIES_INVALID', maximumBytes: 64 * 1024,
  }), { buildInfo: info.buildInfo, inventory });
  const after = await readManifest(); assertCurrent();
  if (!before.equals(after)) throw invalid();
  return Object.freeze({ pin, manifest, ...info });
}

async function readManifestBytes() {
  const root = dirname(manifestPath);
  const before = await ordinaryPath(root, manifestPath);
  const file = await open(manifestPath, 'r');
  let result, failure;
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size < 2 || opened.size > 64 * 1024 ||
        !isDeepStrictEqual(fingerprint(before), fingerprint(opened))) throw invalid();
    const bytes = Buffer.alloc(opened.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== opened.size || !isDeepStrictEqual(fingerprint(opened), fingerprint(await file.stat())) ||
        !isDeepStrictEqual(fingerprint(opened), fingerprint(await ordinaryPath(root, manifestPath)))) throw invalid();
    result = bytes.subarray(0, bytesRead);
  } catch (error) { failure = { error }; }
  try { await file.close(); }
  catch (error) { failure = { error: failure === undefined ? error : new AggregateError([failure.error, error],
    'PACKAGED_PILOT_SERIES_CLOSE_FAILED', { cause: failure.error }) }; }
  if (failure !== undefined) throw failure.error;
  return result;
}
