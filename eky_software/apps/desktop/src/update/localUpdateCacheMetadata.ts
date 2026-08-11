import type { LocalUpdateCacheSlotRole } from './updatePackageTrustPolicy.js';

const fields = new Set([
  'appVersion',
  'buildRevision',
  'createdAt',
  'msiProductVersion',
  'packageFilename',
  'packageSha256',
  'packageSize',
  'role',
  'schemaVersion',
]);
const semVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const msiVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const revisionPattern = /^[0-9a-f]{7,40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

export interface LocalUpdateCacheMetadata {
  appVersion: string;
  buildRevision: string;
  createdAt: string;
  msiProductVersion: string;
  packageFilename: string;
  packageSha256: string;
  packageSize: number;
  role: LocalUpdateCacheSlotRole;
  schemaVersion: 1;
}

export class LocalUpdateCacheMetadataError extends Error {
  constructor() {
    super('The local update cache metadata is invalid.');
    this.name = 'LocalUpdateCacheMetadataError';
  }
}

export function parseLocalUpdateCacheMetadata(
  value: unknown,
): Readonly<LocalUpdateCacheMetadata> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.size ||
    Object.keys(value).some((key) => !fields.has(key)) ||
    value.schemaVersion !== 1 ||
    (value.role !== 'current' &&
      value.role !== 'candidate' &&
      value.role !== 'previous') ||
    typeof value.appVersion !== 'string' ||
    !semVerPattern.test(value.appVersion) ||
    typeof value.buildRevision !== 'string' ||
    !revisionPattern.test(value.buildRevision) ||
    typeof value.createdAt !== 'string' ||
    !isUtcTimestamp(value.createdAt) ||
    typeof value.msiProductVersion !== 'string' ||
    !isMsiProductVersion(value.msiProductVersion) ||
    typeof value.packageFilename !== 'string' ||
    value.packageFilename !== `Eky-${value.appVersion}-x64.msi` ||
    typeof value.packageSha256 !== 'string' ||
    !sha256Pattern.test(value.packageSha256) ||
    !Number.isSafeInteger(value.packageSize) ||
    (value.packageSize as number) < 1
  ) {
    throw new LocalUpdateCacheMetadataError();
  }
  return Object.freeze({
    appVersion: value.appVersion,
    buildRevision: value.buildRevision,
    createdAt: value.createdAt,
    msiProductVersion: value.msiProductVersion,
    packageFilename: value.packageFilename,
    packageSha256: value.packageSha256,
    packageSize: value.packageSize as number,
    role: value.role,
    schemaVersion: 1,
  });
}

function isMsiProductVersion(value: string): boolean {
  const match = msiVersionPattern.exec(value);
  return (
    match !== null &&
    Number(match[1]) <= 255 &&
    Number(match[2]) <= 255 &&
    Number(match[3]) <= 65_535
  );
}

function isUtcTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
