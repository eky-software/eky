import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { INSTALLER_APP_IDENTITY } from './installerIdentity.mjs';
import { parseMsiProductVersion } from './installerVersion.mjs';

const sha256Pattern = /^[0-9a-f]{64}$/;
const revisionPattern = /^[0-9a-f]{7,40}$/;
const manifestFields = new Set([
  'appIdentity',
  'appVersion',
  'architecture',
  'buildRevision',
  'manifestFormatVersion',
  'msiProductVersion',
  'packageFilename',
  'packageKind',
  'packageSha256',
  'packageSize',
  'platform',
  'releaseChannel',
  'signing',
]);
const signingFields = new Set([
  'publisher',
  'status',
  'thumbprint',
  'timestamped',
]);

export async function createInstallerManifest({
  buildRevision,
  installerPath,
  release,
  signing = unsignedPrototypeSigning(),
}) {
  const packageStat = await stat(installerPath);
  return validateInstallerManifest({
    appIdentity: release.appIdentity,
    appVersion: release.appVersion,
    architecture: release.architecture,
    buildRevision,
    manifestFormatVersion: 1,
    msiProductVersion: release.msiProductVersion,
    packageFilename: basename(installerPath),
    packageKind: 'windows-installer-msi',
    packageSha256: await hashFileSha256(installerPath),
    packageSize: packageStat.size,
    platform: release.platform,
    releaseChannel: release.releaseChannel,
    signing,
  });
}

async function hashFileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function writeInstallerManifest(path, manifest) {
  const validated = validateInstallerManifest(manifest);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}

export async function readInstallerManifest(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
  return validateInstallerManifest(value);
}

export function validateInstallerManifest(value) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== manifestFields.size ||
    Object.keys(value).some((key) => !manifestFields.has(key)) ||
    value.manifestFormatVersion !== 1 ||
    value.appIdentity !== INSTALLER_APP_IDENTITY ||
    typeof value.appVersion !== 'string' ||
    typeof value.msiProductVersion !== 'string' ||
    !revisionPattern.test(value.buildRevision) ||
    !['pilot', 'stable'].includes(value.releaseChannel) ||
    value.platform !== 'win32' ||
    value.architecture !== 'x64' ||
    value.packageKind !== 'windows-installer-msi' ||
    typeof value.packageFilename !== 'string' ||
    !/^Eky-[0-9A-Za-z.+-]+-x64\.msi$/.test(value.packageFilename) ||
    !Number.isSafeInteger(value.packageSize) ||
    value.packageSize < 1 ||
    !sha256Pattern.test(value.packageSha256) ||
    !isValidSigning(value.signing)
  ) {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
  parseMsiProductVersion(value.msiProductVersion);
  return Object.freeze({
    ...value,
    signing: Object.freeze({ ...value.signing }),
  });
}

function unsignedPrototypeSigning() {
  return Object.freeze({
    publisher: null,
    status: 'unsigned-prototype',
    thumbprint: null,
    timestamped: false,
  });
}

function isValidSigning(value) {
  return (
    isRecord(value) &&
    Object.keys(value).length === signingFields.size &&
    Object.keys(value).every((key) => signingFields.has(key)) &&
    value.status === 'unsigned-prototype' &&
    value.publisher === null &&
    value.thumbprint === null &&
    value.timestamped === false
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
