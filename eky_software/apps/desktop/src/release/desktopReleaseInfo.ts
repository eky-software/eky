import { isSemVer } from './desktopBuildInfo.js';

const releaseInfoFields = new Set([
  'appIdentity',
  'appVersion',
  'architecture',
  'buildRevision',
  'msiProductVersion',
  'platform',
  'releaseChannel',
  'schemaVersion',
  'upgradeCode',
]);
const buildRevisionPattern = /^[0-9a-f]{7,40}$/;
const msiProductVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const upgradeCodePattern = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

export interface DesktopReleaseInfo {
  appIdentity: 'Eky';
  appVersion: string;
  architecture: 'x64';
  buildRevision: string;
  msiProductVersion: string;
  platform: 'win32';
  releaseChannel: 'pilot';
  schemaVersion: 1;
  upgradeCode: string;
}

export class DesktopReleaseInfoValidationError extends Error {
  constructor() {
    super('Desktop release information is invalid.');
    this.name = 'DesktopReleaseInfoValidationError';
  }
}

export function parseDesktopReleaseInfo(
  value: unknown,
  expectedAppVersion?: string,
): Readonly<DesktopReleaseInfo> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== releaseInfoFields.size ||
    Object.keys(value).some((key) => !releaseInfoFields.has(key)) ||
    value.schemaVersion !== 1 ||
    value.appIdentity !== 'Eky' ||
    typeof value.appVersion !== 'string' ||
    !isSemVer(value.appVersion) ||
    (expectedAppVersion !== undefined && value.appVersion !== expectedAppVersion) ||
    value.architecture !== 'x64' ||
    typeof value.buildRevision !== 'string' ||
    !buildRevisionPattern.test(value.buildRevision) ||
    typeof value.msiProductVersion !== 'string' ||
    !isMsiProductVersion(value.msiProductVersion) ||
    value.platform !== 'win32' ||
    value.releaseChannel !== 'pilot' ||
    typeof value.upgradeCode !== 'string' ||
    !upgradeCodePattern.test(value.upgradeCode)
  ) {
    throw new DesktopReleaseInfoValidationError();
  }

  return Object.freeze({
    appIdentity: 'Eky',
    appVersion: value.appVersion,
    architecture: 'x64',
    buildRevision: value.buildRevision,
    msiProductVersion: value.msiProductVersion,
    platform: 'win32',
    releaseChannel: 'pilot',
    schemaVersion: 1,
    upgradeCode: value.upgradeCode,
  });
}

function isMsiProductVersion(value: string): boolean {
  const match = msiProductVersionPattern.exec(value);
  return (
    match !== null &&
    Number(match[1]) <= 255 &&
    Number(match[2]) <= 255 &&
    Number(match[3]) <= 65_535
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
