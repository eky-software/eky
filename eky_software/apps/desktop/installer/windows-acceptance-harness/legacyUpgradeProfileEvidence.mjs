import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import {
  createClosedDirectoryInventory,
  inventoriesMatch,
} from './closedDirectoryInventory.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const LEGACY_SOURCE_EVIDENCE_FILENAME = 'legacy-source-evidence.json';
export const LEGACY_FIRST_START_EVIDENCE_FILENAME = 'legacy-first-start-evidence.json';
export const LEGACY_SECOND_START_EVIDENCE_FILENAME = 'legacy-second-start-evidence.json';

const ACCEPTED_BUILD_KEYS = [
  'acceptedAt',
  'appVersion',
  'buildRevision',
  'formatVersion',
  'releaseChannel',
];
const REGISTRY_KEYS = ['activeWorkspaceId', 'formatVersion', 'workspaces'];
const WORKSPACE_KEYS = [
  'createdAt',
  'layoutVersion',
  'lifecycleState',
  'lineageIdentity',
  'workspaceId',
  'workspaceLabel',
];
const LINEAGE_KEYS = ['formatVersion', 'profileId'];
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const BUILD_REVISION_PATTERN = /^[0-9a-f]{7,40}$/;

function isRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateAcceptedBuildMetadata(value) {
  if (
    !hasExactKeys(value, ACCEPTED_BUILD_KEYS) ||
    value.formatVersion !== 1 ||
    value.releaseChannel !== 'pilot' ||
    typeof value.appVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.appVersion) ||
    typeof value.buildRevision !== 'string' ||
    !BUILD_REVISION_PATTERN.test(value.buildRevision) ||
    !canonicalTimestamp(value.acceptedAt)
  ) {
    throw new Error('acceptedBuildInvalid');
  }
  return Object.freeze({ ...value });
}

async function readAcceptedCandidate(path) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size < 2n ||
      metadata.size > 4_096n
    ) {
      return Object.freeze({ state: 'invalid', value: null });
    }
    return Object.freeze({
      state: 'present',
      value: validateAcceptedBuildMetadata(
        parseStrictJsonObjectBytes(await readFile(path), {
          errorCode: 'acceptedBuildInvalid',
        }),
      ),
    });
  } catch (error) {
    return error?.code === 'ENOENT'
      ? Object.freeze({ state: 'missing', value: null })
      : Object.freeze({ state: 'invalid', value: null });
  }
}

export function resolveAcceptedBuildCandidates({ current, backup, next }) {
  const candidates = [current, backup, next];
  if (
    candidates.some(
      (entry) =>
        !isRecord(entry) ||
        !['invalid', 'missing', 'present'].includes(entry.state) ||
        (entry.state === 'present') !== (entry.value !== null),
    ) ||
    candidates.some((entry) => entry.state === 'invalid')
  ) {
    return Object.freeze({ state: 'invalid', value: null });
  }
  const present = candidates.filter((entry) => entry.state === 'present');
  if (present.length === 0) {
    return Object.freeze({ state: 'missing', value: null });
  }
  const selected = current.state === 'present' ? current : present[0];
  if (present.some((entry) => !valuesEqual(entry.value, selected.value))) {
    return Object.freeze({ state: 'invalid', value: null });
  }
  return Object.freeze({ state: 'present', value: selected.value });
}

export async function readAcceptedBuildSlot(filePath) {
  return resolveAcceptedBuildCandidates({
    current: await readAcceptedCandidate(filePath),
    backup: await readAcceptedCandidate(`${filePath}.backup`),
    next: await readAcceptedCandidate(`${filePath}.next`),
  });
}

function classifyAcceptedBuild(slot, identities) {
  if (slot.state !== 'present') return slot.state;
  if (
    slot.value.appVersion === identities.source.appVersion &&
    slot.value.buildRevision === identities.source.buildRevision
  ) {
    return 'sourceIdentity';
  }
  if (
    slot.value.appVersion === identities.target.appVersion &&
    identities.target.buildRevision.startsWith(slot.value.buildRevision)
  ) {
    return 'targetIdentity';
  }
  return 'otherIdentity';
}

export async function readAcceptedBuildIdentityState(userDataRoot, identities) {
  const current = await readAcceptedBuildSlot(
    resolve(userDataRoot, 'update-state', 'accepted-build-v1.json'),
  );
  const legacy = await readAcceptedBuildSlot(
    resolve(userDataRoot, 'runtime', 'update-state', 'accepted-build-v1.json'),
  );
  const result = Object.freeze({
    currentClass: classifyAcceptedBuild(current, identities),
    legacyClass: classifyAcceptedBuild(legacy, identities),
  });
  if (result.currentClass === 'invalid' || result.legacyClass === 'invalid') {
    throw new Error('acceptedBuildInvalid');
  }
  return result;
}

async function readStrictObject(path, maximumBytes, errorCode) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size < 2n ||
      metadata.size > BigInt(maximumBytes)
    ) {
      throw new Error(errorCode);
    }
    return parseStrictJsonObjectBytes(await readFile(path), { errorCode });
  } catch {
    throw new Error(errorCode);
  }
}

async function fileIdentity(path, errorCode) {
  try {
    const before = await lstat(path, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size < 1n
    ) {
      throw new Error(errorCode);
    }
    const bytes = await readFile(path);
    const after = await lstat(path, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      BigInt(bytes.byteLength) !== before.size
    ) {
      throw new Error(errorCode);
    }
    return Object.freeze({
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
    });
  } catch {
    throw new Error(errorCode);
  }
}

export async function readLegacyWorkspaceRegistry(userDataRoot) {
  const registryPath = resolve(userDataRoot, 'workspace-registry-v1.json');
  const value = await readStrictObject(
    registryPath,
    1024 * 1024,
    'workspaceRegistryInvalid',
  );
  if (
    !hasExactKeys(value, REGISTRY_KEYS) ||
    value.formatVersion !== 1 ||
    !UUID_V4_PATTERN.test(value.activeWorkspaceId) ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length !== 1
  ) {
    throw new Error('workspaceRegistryInvalid');
  }
  const workspace = value.workspaces[0];
  if (
    !hasExactKeys(workspace, WORKSPACE_KEYS) ||
    workspace.workspaceId !== value.activeWorkspaceId ||
    workspace.workspaceLabel !== 'Oma yritys' ||
    workspace.layoutVersion !== 1 ||
    workspace.lifecycleState !== 'ready' ||
    !canonicalTimestamp(workspace.createdAt) ||
    !hasExactKeys(workspace.lineageIdentity, LINEAGE_KEYS) ||
    workspace.lineageIdentity.formatVersion !== 1 ||
    typeof workspace.lineageIdentity.profileId !== 'string' ||
    !SHA_256_PATTERN.test(workspace.lineageIdentity.profileId)
  ) {
    throw new Error('workspaceRegistryInvalid');
  }
  for (const recoveryPath of [
    `${registryPath}.next`,
    `${registryPath}.backup`,
  ]) {
    try {
      await lstat(recoveryPath);
      throw new Error('workspaceRegistryInvalid');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const identity = await fileIdentity(registryPath, 'workspaceRegistryInvalid');
  return Object.freeze({
    activeWorkspaceId: value.activeWorkspaceId,
    lineageProfileId: workspace.lineageIdentity.profileId,
    registrySha256: identity.sha256,
    registrySize: identity.size,
  });
}

async function requireNoAdoptionResidue(userDataRoot) {
  const forbiddenFiles = [
    resolve(userDataRoot, 'workspace-state', 'workspace-adoption-v1.json'),
    resolve(userDataRoot, 'workspace-state', 'workspace-adoption-v1.json.next'),
    resolve(userDataRoot, 'workspace-state', 'workspace-adoption-v1.json.backup'),
  ];
  for (const path of forbiddenFiles) {
    try {
      await lstat(path);
      throw new Error('workspaceAdoptionResidueInvalid');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const operationsRoot = resolve(userDataRoot, 'workspace-operations');
  try {
    const metadata = await lstat(operationsRoot);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (await readdir(operationsRoot)).length !== 0
    ) {
      throw new Error('workspaceAdoptionResidueInvalid');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function requireNonEmptyBusinessInventory(dataInventory, storageInventory) {
  const database = dataInventory.filter(
    (entry) => entry.kind === 'file' && entry.relativePath === 'eky.sqlite',
  );
  const pdfs = storageInventory.filter(
    (entry) =>
      entry.kind === 'file' && basename(entry.relativePath) === 'approved-invoice.pdf',
  );
  if (database.length !== 1 || database[0].size < 1 || pdfs.length !== 1) {
    throw new Error('legacyBusinessFixtureInvalid');
  }
  return pdfs[0].relativePath;
}

async function requirePdf(root, relativePath) {
  const path = resolve(root, relativePath);
  if (
    relative(root, path).startsWith('..') ||
    isAbsolute(relative(root, path))
  ) {
    throw new Error('legacyBusinessFixtureInvalid');
  }
  const identity = await fileIdentity(path, 'legacyBusinessFixtureInvalid');
  if (
    identity.size < 5 ||
    identity.size > 25 * 1024 * 1024 ||
    identity.bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
  ) {
    throw new Error('legacyBusinessFixtureInvalid');
  }
}

export function deriveLegacySourceUserDataRoot(scenarioRoot, runNonce) {
  if (!SHA_256_PATTERN.test(runNonce)) {
    throw new Error('legacyUserDataInvalid');
  }
  return resolve(
    scenarioRoot,
    'source-smoke-temp',
    'eky-desktop-smoke',
    runNonce.slice(0, 32),
    'user-data',
  );
}

export async function captureLegacySourceEvidence({
  identities,
  scenarioRoot,
  runNonce,
}) {
  const userDataRoot = deriveLegacySourceUserDataRoot(scenarioRoot, runNonce);
  const accepted = await readAcceptedBuildIdentityState(userDataRoot, identities);
  if (
    !(
      (accepted.currentClass === 'sourceIdentity' &&
        accepted.legacyClass === 'missing') ||
      (accepted.currentClass === 'missing' &&
        accepted.legacyClass === 'sourceIdentity')
    )
  ) {
    throw new Error('acceptedBuildIdentityInvalid');
  }
  const dataRoot = resolve(userDataRoot, 'runtime', 'data');
  const storageRoot = resolve(userDataRoot, 'runtime', 'storage');
  const dataInventory = await createClosedDirectoryInventory(dataRoot);
  const storageInventory = await createClosedDirectoryInventory(storageRoot);
  const pdfRelativePath = requireNonEmptyBusinessInventory(
    dataInventory,
    storageInventory,
  );
  await requirePdf(storageRoot, pdfRelativePath);
  return Object.freeze({
    schemaVersion: 1,
    acceptedCurrentClass: accepted.currentClass,
    acceptedLegacyClass: accepted.legacyClass,
    dataInventory,
    pdfRelativePath,
    storageInventory,
  });
}

export async function captureLegacyTargetEvidence({
  identities,
  previousEvidence,
  runtimeInstanceId,
  sourceEvidence,
  userDataRoot,
}) {
  if (
    typeof runtimeInstanceId !== 'string' ||
    !UUID_V4_PATTERN.test(runtimeInstanceId)
  ) {
    throw new Error('targetRuntimeIdentityInvalid');
  }
  const accepted = await readAcceptedBuildIdentityState(userDataRoot, identities);
  if (
    accepted.currentClass !== 'targetIdentity' ||
    !['missing', 'sourceIdentity'].includes(accepted.legacyClass)
  ) {
    throw new Error('acceptedBuildIdentityInvalid');
  }
  const registry = await readLegacyWorkspaceRegistry(userDataRoot);
  await requireNoAdoptionResidue(userDataRoot);
  const legacyData = await createClosedDirectoryInventory(
    resolve(userDataRoot, 'runtime', 'data'),
  );
  const legacyStorage = await createClosedDirectoryInventory(
    resolve(userDataRoot, 'runtime', 'storage'),
  );
  const workspaceRuntimeRoot = resolve(
    userDataRoot,
    'workspaces',
    registry.activeWorkspaceId,
    'runtime',
  );
  const dataInventory = await createClosedDirectoryInventory(
    resolve(workspaceRuntimeRoot, 'data'),
  );
  const storageInventory = await createClosedDirectoryInventory(
    resolve(workspaceRuntimeRoot, 'storage'),
  );
  if (
    !inventoriesMatch(legacyData, sourceEvidence.dataInventory) ||
    !inventoriesMatch(legacyStorage, sourceEvidence.storageInventory) ||
    !inventoriesMatch(dataInventory, sourceEvidence.dataInventory) ||
    !inventoriesMatch(storageInventory, sourceEvidence.storageInventory)
  ) {
    throw new Error('legacyAdoptionContentInvalid');
  }
  await requirePdf(
    resolve(workspaceRuntimeRoot, 'storage'),
    sourceEvidence.pdfRelativePath,
  );
  const evidence = Object.freeze({
    schemaVersion: 1,
    acceptedCurrentClass: accepted.currentClass,
    acceptedLegacyClass: accepted.legacyClass,
    dataInventory,
    registrySha256: registry.registrySha256,
    registrySize: registry.registrySize,
    runtimeInstanceId,
    storageInventory,
    workspaceId: registry.activeWorkspaceId,
  });
  if (
    previousEvidence !== undefined &&
    (previousEvidence.runtimeInstanceId === runtimeInstanceId ||
      previousEvidence.workspaceId !== evidence.workspaceId ||
      previousEvidence.registrySha256 !== evidence.registrySha256 ||
      previousEvidence.registrySize !== evidence.registrySize ||
      !inventoriesMatch(previousEvidence.dataInventory, evidence.dataInventory) ||
      !inventoriesMatch(
        previousEvidence.storageInventory,
        evidence.storageInventory,
      ))
  ) {
    throw new Error('targetSecondStartupNotIdempotent');
  }
  return evidence;
}

function validInventory(value) {
  if (!Array.isArray(value)) return false;
  let previous = '';
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !['directory', 'file'].includes(entry.kind) ||
      typeof entry.relativePath !== 'string' ||
      entry.relativePath === '' ||
      entry.relativePath.includes('\0') ||
      isAbsolute(entry.relativePath) ||
      entry.relativePath.split('/').includes('..') ||
      entry.relativePath <= previous ||
      (entry.kind === 'directory' && Object.keys(entry).length !== 2) ||
      (entry.kind === 'file' &&
        (!hasExactKeys(entry, ['kind', 'relativePath', 'sha256', 'size']) ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          !SHA_256_PATTERN.test(entry.sha256)))
    ) {
      return false;
    }
    previous = entry.relativePath;
  }
  return true;
}

export function validateLegacySourceEvidence(value) {
  if (
    !hasExactKeys(value, [
      'acceptedCurrentClass',
      'acceptedLegacyClass',
      'dataInventory',
      'pdfRelativePath',
      'schemaVersion',
      'storageInventory',
    ]) ||
    value.schemaVersion !== 1 ||
    !['missing', 'sourceIdentity'].includes(value.acceptedCurrentClass) ||
    !['missing', 'sourceIdentity'].includes(value.acceptedLegacyClass) ||
    value.acceptedCurrentClass === value.acceptedLegacyClass ||
    !validInventory(value.dataInventory) ||
    !validInventory(value.storageInventory) ||
    typeof value.pdfRelativePath !== 'string' ||
    value.pdfRelativePath === '' ||
    isAbsolute(value.pdfRelativePath) ||
    value.pdfRelativePath.split('/').includes('..')
  ) {
    throw new Error('legacySourceEvidenceInvalid');
  }
  return Object.freeze({ ...value });
}

export function validateLegacyTargetEvidence(value) {
  if (
    !hasExactKeys(value, [
      'acceptedCurrentClass',
      'acceptedLegacyClass',
      'dataInventory',
      'registrySha256',
      'registrySize',
      'runtimeInstanceId',
      'schemaVersion',
      'storageInventory',
      'workspaceId',
    ]) ||
    value.schemaVersion !== 1 ||
    value.acceptedCurrentClass !== 'targetIdentity' ||
    !['missing', 'sourceIdentity'].includes(value.acceptedLegacyClass) ||
    !validInventory(value.dataInventory) ||
    !validInventory(value.storageInventory) ||
    !SHA_256_PATTERN.test(value.registrySha256) ||
    !Number.isSafeInteger(value.registrySize) ||
    value.registrySize < 2 ||
    !UUID_V4_PATTERN.test(value.runtimeInstanceId) ||
    !UUID_V4_PATTERN.test(value.workspaceId)
  ) {
    throw new Error('legacyTargetEvidenceInvalid');
  }
  return Object.freeze({ ...value });
}

export async function writeLegacySourceEvidence(path, value) {
  await writeJsonAtomicExclusive(path, validateLegacySourceEvidence(value));
}

export async function writeLegacyTargetEvidence(path, value) {
  await writeJsonAtomicExclusive(path, validateLegacyTargetEvidence(value));
}

export async function readLegacySourceEvidence(path) {
  return validateLegacySourceEvidence(
    await readStrictObject(path, 8 * 1024 * 1024, 'legacySourceEvidenceInvalid'),
  );
}

export async function readLegacyTargetEvidence(path) {
  return validateLegacyTargetEvidence(
    await readStrictObject(path, 8 * 1024 * 1024, 'legacyTargetEvidenceInvalid'),
  );
}
