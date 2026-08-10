import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';

export const INSTALLER_APP_IDENTITY = 'Eky';
export const INSTALLER_MANUFACTURER = 'Eky';
export const INSTALLER_PRODUCT_NAME = 'Eky';
export const INSTALLER_UPGRADE_CODE = '302530B2-D950-41F5-8397-264B485FEE9A';
export const INSTALLER_IDENTITY_NAMESPACE =
  '0AAE5B8E-4FC7-47A5-B59E-0A636F21E2BF';
export const INSTALLER_REGISTRY_ROOT = 'Software\\Eky\\Installer';
export const INSTALLER_RELATIVE_INSTALL_ROOT = 'Programs\\Eky';

export function createInstallerProductCode(msiProductVersion) {
  return createNamespacedGuid(`product/${msiProductVersion}`);
}

export function createInstallerComponentCode(relativeDirectory) {
  const normalized = normalizeInstallerLogicalPath(relativeDirectory);
  return createNamespacedGuid(`component/${normalized}`);
}

export function createInstallerRegistryValueName(relativeDirectory) {
  const normalized = normalizeInstallerLogicalPath(relativeDirectory);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function normalizeInstallerLogicalPath(value) {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new Error('INSTALLER_LOGICAL_PATH_INVALID');
  }
  const normalized = value
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '')
    .join('/')
    .toLowerCase();
  if (
    normalized === '' ||
    normalized.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('INSTALLER_LOGICAL_PATH_INVALID');
  }
  return normalized;
}

function createNamespacedGuid(name) {
  const namespaceBytes = Buffer.from(
    INSTALLER_IDENTITY_NAMESPACE.replaceAll('-', ''),
    'hex',
  );
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex').toUpperCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
