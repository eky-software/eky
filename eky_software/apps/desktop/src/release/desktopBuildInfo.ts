export interface DesktopBuildInfo {
  appVersion: string;
  buildCreatedAt: string;
  buildDirty: boolean;
  buildRevision: string;
  schemaVersion: 1;
}

const buildInfoFields = new Set([
  'appVersion',
  'buildCreatedAt',
  'buildDirty',
  'buildRevision',
  'schemaVersion',
]);
const semVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const numericReleaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const buildRevisionPattern = /^[0-9a-f]{7,40}$/;

export class DesktopBuildInfoValidationError extends Error {
  constructor() {
    super('Desktop build information is invalid.');
    this.name = 'DesktopBuildInfoValidationError';
  }
}

export function parseDesktopBuildInfo(
  value: unknown,
  options: {
    allowDevelopmentRevision?: boolean;
    expectedAppVersion?: string;
  } = {},
): Readonly<DesktopBuildInfo> {
  if (!isRecord(value) || Object.keys(value).some((key) => !buildInfoFields.has(key))) {
    throw new DesktopBuildInfoValidationError();
  }

  if (
    value.schemaVersion !== 1 ||
    typeof value.appVersion !== 'string' ||
    !isSemVer(value.appVersion) ||
    (options.expectedAppVersion !== undefined &&
      value.appVersion !== options.expectedAppVersion) ||
    typeof value.buildCreatedAt !== 'string' ||
    !isUtcIsoTimestamp(value.buildCreatedAt) ||
    typeof value.buildDirty !== 'boolean' ||
    typeof value.buildRevision !== 'string' ||
    (!buildRevisionPattern.test(value.buildRevision) &&
      !(
        options.allowDevelopmentRevision === true &&
        value.buildRevision === 'development'
      ))
  ) {
    throw new DesktopBuildInfoValidationError();
  }

  return Object.freeze({
    appVersion: value.appVersion,
    buildCreatedAt: value.buildCreatedAt,
    buildDirty: value.buildDirty,
    buildRevision: value.buildRevision,
    schemaVersion: 1,
  });
}

export function isSemVer(value: string): boolean {
  return semVerPattern.test(value);
}

export function isNumericReleaseVersion(value: string): boolean {
  return numericReleaseVersionPattern.test(value);
}

export function isPackagedBuildRevision(value: string): boolean {
  return buildRevisionPattern.test(value);
}

function isUtcIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    !Number.isNaN(timestamp) &&
    new Date(timestamp).toISOString() === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
