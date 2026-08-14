import { readFile } from 'node:fs/promises';

const revisionPattern = /^[0-9a-f]{7,40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const numericReleaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const manifestFields = new Set([
  'appIdentity',
  'appVersion',
  'architecture',
  'buildRevision',
  'inventoryFileCount',
  'inventoryIdentity',
  'inventoryTotalByteSize',
  'manifestFormatVersion',
  'packageKind',
  'platform',
  'releaseChannel',
]);

export function assertPilotBuildPreconditions({ buildInfo, currentHead }) {
  if (
    buildInfo.buildDirty !== false ||
    !isNumericReleaseVersion(buildInfo.appVersion) ||
    !revisionPattern.test(buildInfo.buildRevision) ||
    !revisionPattern.test(currentHead) ||
    !currentHead.startsWith(buildInfo.buildRevision)
  ) {
    throw new Error('PILOT_BUILD_PRECONDITION_FAILED');
  }
}

export function createPilotArtifactManifest({ buildInfo, inventory }) {
  assertPilotBuildPreconditions({
    buildInfo,
    currentHead: buildInfo.buildRevision,
  });
  if (
    inventory.stage !== 'packagedApp' ||
    !Number.isSafeInteger(inventory.fileCount) ||
    inventory.fileCount < 1 ||
    !Number.isSafeInteger(inventory.totalByteSize) ||
    inventory.totalByteSize < 1 ||
    !sha256Pattern.test(inventory.identity)
  ) {
    throw new Error('PILOT_ARTIFACT_MANIFEST_INVALID');
  }
  return Object.freeze({
    appIdentity: 'Eky',
    appVersion: buildInfo.appVersion,
    architecture: 'x64',
    buildRevision: buildInfo.buildRevision,
    inventoryFileCount: inventory.fileCount,
    inventoryIdentity: inventory.identity,
    inventoryTotalByteSize: inventory.totalByteSize,
    manifestFormatVersion: 1,
    packageKind: 'unpacked-windows-application',
    platform: 'win32',
    releaseChannel: 'pilot',
  });
}

export async function readPilotArtifactManifest(path, expected) {
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('PILOT_ARTIFACT_MANIFEST_MISSING_OR_INVALID');
  }
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !manifestFields.has(key)) ||
    Object.keys(value).length !== manifestFields.size ||
    value.manifestFormatVersion !== 1 ||
    value.appIdentity !== 'Eky' ||
    value.appVersion !== expected.buildInfo.appVersion ||
    value.buildRevision !== expected.buildInfo.buildRevision ||
    value.releaseChannel !== 'pilot' ||
    value.platform !== 'win32' ||
    value.architecture !== 'x64' ||
    value.packageKind !== 'unpacked-windows-application' ||
    value.inventoryFileCount !== expected.inventory.fileCount ||
    value.inventoryTotalByteSize !== expected.inventory.totalByteSize ||
    value.inventoryIdentity !== expected.inventory.identity
  ) {
    throw new Error('PILOT_ARTIFACT_MANIFEST_MISSING_OR_INVALID');
  }
  return Object.freeze({ ...value });
}

function isNumericReleaseVersion(value) {
  return typeof value === 'string' && numericReleaseVersionPattern.test(value);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
