import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { INSTALLER_APP_IDENTITY } from './installerIdentity.mjs';
import {
  parseAppVersion,
  parseMsiProductVersion,
} from './installerVersion.mjs';

const sha256Pattern = /^[0-9a-f]{64}$/;
const revisionPattern = /^[0-9a-f]{7,40}$/;
export const INSTALLER_MANIFEST_MAX_BYTES = 64 * 1024;
export const INSTALLER_PACKAGE_MAX_BYTES = 512 * 1024 * 1024;
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
  await assertRegularInstallerFile(installerPath);
  const packageIdentity = await hashFileSha256(installerPath);
  return validateInstallerManifest({
    appIdentity: release.appIdentity,
    appVersion: release.appVersion,
    architecture: release.architecture,
    buildRevision,
    manifestFormatVersion: 1,
    msiProductVersion: release.msiProductVersion,
    packageFilename: basename(installerPath),
    packageKind: 'windows-installer-msi',
    packageSha256: packageIdentity.sha256,
    packageSize: packageIdentity.size,
    platform: release.platform,
    releaseChannel: release.releaseChannel,
    signing,
  });
}

async function hashFileSha256(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return Object.freeze({ sha256: hash.digest('hex'), size });
}

export async function writeInstallerManifest(path, manifest) {
  const validated = validateInstallerManifest(manifest);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

export async function readInstallerManifest(path) {
  let value;
  try {
    await assertRegularManifestFile(path);
    value = parseInstallerManifestBytes(await readFile(path));
  } catch {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
  return validateInstallerManifest(value);
}

export async function verifyInstallerManifestPackage({
  expectedBuildRevision,
  expectedRelease,
  installerPath,
  manifest,
}) {
  const validated = validateInstallerManifest(manifest);
  if (
    validated.packageFilename !== basename(installerPath) ||
    (expectedBuildRevision !== undefined &&
      validated.buildRevision !== expectedBuildRevision) ||
    (expectedRelease !== undefined &&
      !matchesRelease(validated, expectedRelease))
  ) {
    throw new Error('INSTALLER_MANIFEST_RELEASE_MISMATCH');
  }

  await assertRegularInstallerFile(installerPath);
  const packageIdentity = await hashFileSha256(installerPath);
  await assertRegularInstallerFile(installerPath);
  if (
    packageIdentity.size !== validated.packageSize ||
    packageIdentity.sha256 !== validated.packageSha256
  ) {
    throw new Error('INSTALLER_PACKAGE_DOES_NOT_MATCH_MANIFEST');
  }
  return validated;
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
    value.releaseChannel !== 'pilot' ||
    value.platform !== 'win32' ||
    value.architecture !== 'x64' ||
    value.packageKind !== 'windows-installer-msi' ||
    typeof value.packageFilename !== 'string' ||
    !Number.isSafeInteger(value.packageSize) ||
    value.packageSize < 1 ||
    value.packageSize > INSTALLER_PACKAGE_MAX_BYTES ||
    !sha256Pattern.test(value.packageSha256) ||
    !isValidSigning(value.signing)
  ) {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
  parseAppVersion(value.appVersion);
  parseMsiProductVersion(value.msiProductVersion);
  if (value.packageFilename !== `Eky-${value.appVersion}-x64.msi`) {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
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

function matchesRelease(manifest, release) {
  return (
    manifest.appIdentity === release.appIdentity &&
    manifest.appVersion === release.appVersion &&
    manifest.architecture === release.architecture &&
    manifest.msiProductVersion === release.msiProductVersion &&
    manifest.platform === release.platform &&
    manifest.releaseChannel === release.releaseChannel &&
    manifest.packageFilename === `Eky-${release.appVersion}-x64.msi`
  );
}

async function assertRegularInstallerFile(path) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
      throw new Error('INSTALLER_PACKAGE_MISSING_OR_INVALID');
    }
  } catch {
    throw new Error('INSTALLER_PACKAGE_MISSING_OR_INVALID');
  }
}

async function assertRegularManifestFile(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseInstallerManifestBytes(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > INSTALLER_MANIFEST_MAX_BYTES
  ) {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(source);
    assertNoDuplicateJsonObjectKeys(source);
    return validateInstallerManifest(value);
  } catch {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
}

function assertNoDuplicateJsonObjectKeys(source) {
  let offset = 0;

  function skipWhitespace() {
    while (/\s/u.test(source[offset] ?? '')) {
      offset += 1;
    }
  }

  function readString() {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === '\\') {
        offset += 2;
        continue;
      }
      if (source[offset] === '"') {
        offset += 1;
        return JSON.parse(source.slice(start, offset));
      }
      offset += 1;
    }
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }

  function readValue() {
    skipWhitespace();
    if (source[offset] === '{') {
      readObject();
      return;
    }
    if (source[offset] === '[') {
      readArray();
      return;
    }
    if (source[offset] === '"') {
      readString();
      return;
    }
    while (
      offset < source.length &&
      !/[\s,\]}]/u.test(source[offset])
    ) {
      offset += 1;
    }
  }

  function readObject() {
    const keys = new Set();
    offset += 1;
    skipWhitespace();
    if (source[offset] === '}') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      skipWhitespace();
      const key = readString();
      if (keys.has(key)) {
        throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
      }
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') {
        throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
      }
      offset += 1;
      readValue();
      skipWhitespace();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') {
        throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
      }
      offset += 1;
    }
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }

  function readArray() {
    offset += 1;
    skipWhitespace();
    if (source[offset] === ']') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      readValue();
      skipWhitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') {
        throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
      }
      offset += 1;
    }
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }

  readValue();
  skipWhitespace();
  if (offset !== source.length) {
    throw new Error('INSTALLER_MANIFEST_MISSING_OR_INVALID');
  }
}
