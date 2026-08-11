import { createHash } from 'node:crypto';

const installerIdentityNamespace =
  '0AAE5B8E-4FC7-47A5-B59E-0A636F21E2BF';
const msiProductVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export class WindowsInstallerProductCodeError extends Error {
  constructor() {
    super('The Windows installer ProductCode could not be derived.');
    this.name = 'WindowsInstallerProductCodeError';
  }
}

export function createExpectedWindowsInstallerProductCode(
  msiProductVersion: string,
): string {
  assertMsiProductVersion(msiProductVersion);
  const namespaceBytes = Buffer.from(
    installerIdentityNamespace.replaceAll('-', ''),
    'hex',
  );
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(`product/${msiProductVersion}`, 'utf8')
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.toString('hex').toUpperCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function assertMsiProductVersion(value: string): void {
  const match = msiProductVersionPattern.exec(value);
  if (
    match === null ||
    Number(match[1]) > 255 ||
    Number(match[2]) > 255 ||
    Number(match[3]) > 65_535
  ) {
    throw new WindowsInstallerProductCodeError();
  }
}
