import { readFile } from 'node:fs/promises';

const semVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const numericAppVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const msiVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseConfigFields = new Set([
  'appIdentity',
  'appVersion',
  'architecture',
  'msiProductVersion',
  'platform',
  'releaseChannel',
]);

export function parseMsiProductVersion(value) {
  if (typeof value !== 'string') {
    throw new Error('MSI_PRODUCT_VERSION_INVALID');
  }
  const match = msiVersionPattern.exec(value);
  if (match === null) {
    throw new Error('MSI_PRODUCT_VERSION_INVALID');
  }
  const parts = match.slice(1).map(Number);
  if (parts[0] > 255 || parts[1] > 255 || parts[2] > 65_535) {
    throw new Error('MSI_PRODUCT_VERSION_INVALID');
  }
  return Object.freeze(parts);
}

export function parseAppVersion(value) {
  if (typeof value !== 'string' || !semVerPattern.test(value)) {
    throw new Error('APP_VERSION_INVALID');
  }
  return value;
}

export function parseNumericAppVersion(value) {
  if (typeof value !== 'string' || !numericAppVersionPattern.test(value)) {
    throw new Error('APP_VERSION_INVALID');
  }
  return value;
}

export function compareMsiProductVersions(left, right) {
  const leftParts = parseMsiProductVersion(left);
  const rightParts = parseMsiProductVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return Math.sign(leftParts[index] - rightParts[index]);
    }
  }
  return 0;
}

export function validateInstallerReleaseConfig(value, desktopAppVersion) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== releaseConfigFields.size ||
    Object.keys(value).some((key) => !releaseConfigFields.has(key)) ||
    value.appIdentity !== 'Eky' ||
    typeof value.appVersion !== 'string' ||
    !numericAppVersionPattern.test(value.appVersion) ||
    value.appVersion !== desktopAppVersion ||
    value.architecture !== 'x64' ||
    value.platform !== 'win32' ||
    !['pilot', 'stable'].includes(value.releaseChannel)
  ) {
    throw new Error('INSTALLER_RELEASE_CONFIG_INVALID');
  }
  parseMsiProductVersion(value.msiProductVersion);
  return Object.freeze({ ...value });
}

export async function readInstallerReleaseConfig(configPath, desktopPackagePath) {
  let config;
  let desktopPackage;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
    desktopPackage = JSON.parse(await readFile(desktopPackagePath, 'utf8'));
  } catch {
    throw new Error('INSTALLER_RELEASE_CONFIG_MISSING_OR_INVALID');
  }
  if (!isRecord(desktopPackage) || typeof desktopPackage.version !== 'string') {
    throw new Error('INSTALLER_RELEASE_CONFIG_MISSING_OR_INVALID');
  }
  return validateInstallerReleaseConfig(config, desktopPackage.version);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
