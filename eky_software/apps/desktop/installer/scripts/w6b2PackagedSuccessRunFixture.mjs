import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';

const proofTokenPattern = /^[0-9a-f]{64}$/u;
export const w6b2PackagedProofPathTokenLength = 32;
const buildRevisionPattern = /^[0-9a-f]{7,40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const productCodePattern =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/u;
const roles = Object.freeze(['source', 'target']);
const phases = Object.freeze([
  'sourceHandoff',
  'targetFirstStart',
  'switchToB',
  'verifyBRestart',
  'switchToA',
  'rejectC',
]);
export const w6b2PackagedProofDirectoryName = 'eky-w6b2';

export async function createW6b2PackagedSuccessRunFixture(input) {
  requireInstallerPair(input.installerPair);
  const token = input.token ?? randomBytes(32).toString('hex');
  if (!proofTokenPattern.test(token)) {
    throw new Error('W6B2_SUCCESS_PROOF_TOKEN_INVALID');
  }
  const temporaryRoot = resolve(input.temporaryRoot);
  const canonicalTemporaryRoot = await realpath(temporaryRoot);
  if (!samePath(temporaryRoot, canonicalTemporaryRoot)) {
    throw new Error('W6B2_SUCCESS_PROOF_ROOT_INVALID');
  }
  const proofParent = join(temporaryRoot, w6b2PackagedProofDirectoryName);
  await mkdir(proofParent, { mode: 0o700, recursive: true });
  await requireCanonicalDirectory(temporaryRoot, proofParent);
  const proofRoot = join(proofParent, deriveProofPathToken(token));
  await mkdir(proofRoot, { mode: 0o700, recursive: false });
  await requireCanonicalDirectory(proofParent, proofRoot);

  try {
    const source = await stagePackage({
      buildRevision: input.installerPair.buildRevision,
      package: input.installerPair.source,
      proofRoot,
      role: 'source',
      version: '0.2.7',
    });
    const target = await stagePackage({
      buildRevision: input.installerPair.buildRevision,
      package: input.installerPair.target,
      proofRoot,
      role: 'target',
      version: '0.2.8',
    });
    const controlRoot = join(proofRoot, 'control');
    await mkdir(controlRoot, { mode: 0o700 });
    const userDataRoot = join(proofRoot, 'user-data');
    await mkdir(userDataRoot, { mode: 0o700 });
    await requireCanonicalDirectory(proofRoot, userDataRoot);
    await writePrivateJson(join(controlRoot, 'w6b2-profile-input-v1.json'), {
      formatVersion: 1,
      sourceBuildRevision: input.installerPair.buildRevision,
    });
    await writeW6b2PackagedSuccessPhase(proofRoot, 'sourceHandoff');
    return Object.freeze({
      proofRoot,
      source,
      target,
      token,
    });
  } catch (error) {
    await removeW6b2PackagedSuccessRunFixture({
      proofRoot,
      temporaryRoot,
      token,
    }).catch(() => undefined);
    throw error;
  }
}

export async function writeW6b2PackagedSuccessPhase(proofRoot, phase) {
  if (!phases.includes(phase)) {
    throw new Error('W6B2_SUCCESS_PHASE_INVALID');
  }
  const controlRoot = join(resolve(proofRoot), 'control');
  await requireCanonicalDirectory(resolve(proofRoot), controlRoot);
  const phasePath = join(controlRoot, 'phase.json');
  const nextPhasePath = join(controlRoot, 'phase.next.json');
  await rm(nextPhasePath, { force: true });
  try {
    await writePrivateJson(nextPhasePath, { formatVersion: 1, phase });
    await rename(nextPhasePath, phasePath);
  } finally {
    await rm(nextPhasePath, { force: true });
  }
}

export async function verifyW6b2PackagedSuccessRunFixture(input) {
  if (!proofTokenPattern.test(input.token)) {
    throw new Error('W6B2_SUCCESS_PROOF_TOKEN_INVALID');
  }
  const expectedRoot = join(
    resolve(input.temporaryRoot),
    w6b2PackagedProofDirectoryName,
    deriveProofPathToken(input.token),
  );
  if (!samePath(expectedRoot, input.proofRoot)) {
    throw new Error('W6B2_SUCCESS_PROOF_ROOT_INVALID');
  }
  await requireCanonicalDirectory(dirname(expectedRoot), expectedRoot);
  await requireCanonicalDirectory(expectedRoot, join(expectedRoot, 'user-data'));
  await verifyStagedPackage(input.source, 'source', '0.2.7');
  await verifyStagedPackage(input.target, 'target', '0.2.8');
}

export async function removeW6b2PackagedSuccessRunFixture(input) {
  if (!proofTokenPattern.test(input.token)) {
    throw new Error('W6B2_SUCCESS_PROOF_TOKEN_INVALID');
  }
  const temporaryRoot = resolve(input.temporaryRoot);
  const expectedRoot = join(
    temporaryRoot,
    w6b2PackagedProofDirectoryName,
    deriveProofPathToken(input.token),
  );
  if (!samePath(expectedRoot, input.proofRoot)) {
    throw new Error('W6B2_SUCCESS_PROOF_ROOT_INVALID');
  }
  try {
    const metadata = await lstat(expectedRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('W6B2_SUCCESS_PROOF_ROOT_INVALID');
    }
    if (!samePath(await realpath(expectedRoot), expectedRoot)) {
      throw new Error('W6B2_SUCCESS_PROOF_ROOT_INVALID');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  await rm(expectedRoot, { force: true, recursive: true });
}

async function stagePackage(input) {
  const manifest = await readInstallerManifest(input.package.manifestPath);
  if (
    manifest.appVersion !== input.version ||
    manifest.buildRevision !== input.buildRevision ||
    manifest.packageSha256 !== input.package.packageSha256 ||
    manifest.packageSize !== input.package.packageSize ||
    basename(input.package.installerPath) !== manifest.packageFilename
  ) {
    throw new Error('W6B2_SUCCESS_PACKAGE_IDENTITY_INVALID');
  }
  await verifyInstallerManifestPackage({
    expectedBuildRevision: input.buildRevision,
    installerPath: input.package.installerPath,
    manifest,
  });
  const roleRoot = join(input.proofRoot, 'packages', input.role);
  await mkdir(roleRoot, { mode: 0o700, recursive: true });
  await requireCanonicalDirectory(input.proofRoot, roleRoot);
  const installerPath = join(roleRoot, manifest.packageFilename);
  const manifestPath = join(roleRoot, 'manifest.json');
  await copyFile(
    input.package.installerPath,
    installerPath,
    constants.COPYFILE_EXCL,
  );
  await copyFile(
    input.package.manifestPath,
    manifestPath,
    constants.COPYFILE_EXCL,
  );
  const staged = Object.freeze({
    installerPath,
    manifestPath,
    packageSha256: manifest.packageSha256,
    packageSize: manifest.packageSize,
    productCode: input.package.productCode,
  });
  await verifyStagedPackage(staged, input.role, input.version);
  return staged;
}

async function verifyStagedPackage(value, role, version) {
  if (!roles.includes(role)) {
    throw new Error('W6B2_SUCCESS_PACKAGE_IDENTITY_INVALID');
  }
  const manifest = await readInstallerManifest(value.manifestPath);
  if (
    manifest.appVersion !== version ||
    manifest.packageSha256 !== value.packageSha256 ||
    manifest.packageSize !== value.packageSize ||
    basename(value.installerPath) !== manifest.packageFilename
  ) {
    throw new Error('W6B2_SUCCESS_PACKAGE_IDENTITY_INVALID');
  }
  await verifyInstallerManifestPackage({
    expectedBuildRevision: manifest.buildRevision,
    installerPath: value.installerPath,
    manifest,
  });
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

async function requireCanonicalDirectory(parent, directory) {
  const metadata = await lstat(directory);
  const canonical = await realpath(directory);
  const child = relative(resolve(parent), canonical);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    child.length === 0 ||
    child.startsWith('..') ||
    !samePath(canonical, directory)
  ) {
    throw new Error('W6B2_SUCCESS_PROOF_ROOT_INVALID');
  }
}

function requireInstallerPair(pair) {
  if (
    !isRecord(pair) ||
    pair.buildRevision === undefined ||
    !buildRevisionPattern.test(pair.buildRevision) ||
    !isPackage(pair.source, '0.2.7') ||
    !isPackage(pair.target, '0.2.8') ||
    pair.source.productCode === pair.target.productCode
  ) {
    throw new Error('W6B2_SUCCESS_PACKAGE_IDENTITY_INVALID');
  }
}

function isPackage(value, version) {
  return (
    isRecord(value) &&
    value.appVersion === version &&
    typeof value.installerPath === 'string' &&
    typeof value.manifestPath === 'string' &&
    typeof value.packageSha256 === 'string' &&
    sha256Pattern.test(value.packageSha256) &&
    Number.isSafeInteger(value.packageSize) &&
    value.packageSize > 0 &&
    typeof value.productCode === 'string' &&
    productCodePattern.test(value.productCode)
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function deriveProofPathToken(token) {
  if (!proofTokenPattern.test(token)) {
    throw new Error('W6B2_SUCCESS_PROOF_TOKEN_INVALID');
  }
  return token.slice(0, w6b2PackagedProofPathTokenLength);
}
