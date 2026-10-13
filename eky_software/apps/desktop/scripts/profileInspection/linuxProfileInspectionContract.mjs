import { posix } from 'node:path';
import { exactKeys } from '../../../e2e/experiments/processOwnership/pidNamespaceContract.mjs';
import { linuxProfileInspectionPaths, servicePath } from '../../../e2e/experiments/processOwnership/linuxServiceContract.mjs';

export const inspectionProofVariants = Object.freeze(['current', 'schemaChanged', 'missingNative']);
export const inspectionProofMaximumBytes = 65_536;
const preparationCauses = new Set(['PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID',
  'PROFILE_INSPECTION_NATIVE_SOURCE_INVALID', 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED',
  'PROFILE_INSPECTION_PROTOCOL_INVALID', 'LINUX_PROFILE_INSPECTION_PROOF_INVALID']);
export function inspectionPreparationFailure(phase, error) {
  return { operation: 'linuxProfileInspection', status: 'failed', phase,
    causeCode: error instanceof Error && preparationCauses.has(error.message) ? error.message : 'unknown' };
}
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) && value.length === 64;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value) && value.length === 36;
export function requireInspectionProof(condition) {
  if (!condition) throw new Error('LINUX_PROFILE_INSPECTION_PROOF_INVALID');
}

export function parseInspectionProofConfig(text) {
  requireInspectionProof(typeof text === 'string' && Buffer.byteLength(text) <= inspectionProofMaximumBytes);
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('LINUX_PROFILE_INSPECTION_PROOF_INVALID'); }
  requireInspectionProof(JSON.stringify(value) === text && exactKeys(value,
    ['schemaVersion', 'generation', 'variant', 'operationId', 'activeContext', 'expected']) &&
    value.schemaVersion === 1 && uuid(value.generation) && uuid(value.operationId) &&
    inspectionProofVariants.includes(value.variant));
  requireInspectionProof(exactKeys(value.activeContext, ['activeProfileId', 'activeProfileIsEmpty']) &&
    digest(value.activeContext.activeProfileId) && typeof value.activeContext.activeProfileIsEmpty === 'boolean');
  requireInspectionProof(exactKeys(value.expected, ['database', 'artifactCatalog', 'migrationChainIdentity']) &&
    digest(value.expected.migrationChainIdentity));
  for (const entry of [value.expected.database, value.expected.artifactCatalog]) {
    requireInspectionProof(exactKeys(entry, ['byteSize', 'sha256']) && Number.isSafeInteger(entry.byteSize) &&
      entry.byteSize > 0 && digest(entry.sha256));
  }
  return value;
}

export function inspectionProofPaths(configPath, config, hostTempRoot) {
  parseInspectionProofConfig(JSON.stringify(config));
  servicePath(configPath); servicePath(hostTempRoot);
  const runRoot = posix.dirname(posix.dirname(configPath));
  const paths = linuxProfileInspectionPaths(runRoot);
  requireInspectionProof(paths.config === configPath && /^run-[A-Za-z0-9-]+$/u.test(posix.basename(runRoot)) &&
    posix.dirname(runRoot) === posix.join(hostTempRoot, 'eky-e2e'));
  return Object.freeze({ ...paths, runRoot,
    operationRoot: posix.join(paths.root, 'staging', config.operationId),
    resourcesRoot: posix.join(paths.root, config.variant === 'missingNative' ? 'missing-resources' : 'resources'),
    userData: posix.join(paths.root, 'electron-profile'), crashDumps: posix.join(paths.root, 'electron-crash'),
    result: posix.join(paths.root, 'inspection-result.private.json') });
}

export function assertInspectionProofResult(value, config) {
  requireInspectionProof(exactKeys(value, ['schemaVersion', 'generation', 'variant', 'status', 'phase',
    'causeCode', 'observation', 'ownerReleased']) && value.schemaVersion === 1 &&
    value.generation === config.generation && value.variant === config.variant && value.status === 'passed' &&
    value.phase === 'completed' && value.ownerReleased === true);
  const observation = value.observation;
  requireInspectionProof(exactKeys(observation, ['forkCount', 'exitObserved', 'exitCode', 'contextReads',
    'receiptVerified', 'sourcePreserved', 'mainExclusionProved', 'ownerReleaseProved']) &&
    observation.forkCount === 1 && observation.exitObserved === true &&
    observation.exitCode === (config.variant === 'current' ? 0 : 1) &&
    observation.sourcePreserved === true && observation.mainExclusionProved === true &&
    observation.ownerReleaseProved === true);
  const expectedCause = config.variant === 'schemaChanged' ? 'PROFILE_SCHEMA_UNSUPPORTED'
    : config.variant === 'missingNative' ? 'PROFILE_INSPECTION_PROTOCOL_INVALID' : null;
  requireInspectionProof(value.causeCode === expectedCause &&
    observation.receiptVerified === (config.variant === 'current') &&
    observation.contextReads === (config.variant === 'current' ? 2 : 1));
  return value;
}
