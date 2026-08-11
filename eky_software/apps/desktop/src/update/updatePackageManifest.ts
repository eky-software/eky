export const UPDATE_PACKAGE_MANIFEST_MAX_BYTES = 64 * 1024;
export const UPDATE_PACKAGE_MAX_BYTES = 512 * 1024 * 1024;

const expectedAppIdentity = 'Eky';
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
const semVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const msiProductVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const revisionPattern = /^[0-9a-f]{7,40}$/;

export interface LocalUnsignedPilotUpdatePackageManifest {
  appIdentity: 'Eky';
  appVersion: string;
  architecture: 'x64';
  buildRevision: string;
  manifestFormatVersion: 1;
  msiProductVersion: string;
  packageFilename: string;
  packageKind: 'windows-installer-msi';
  packageSha256: string;
  packageSize: number;
  platform: 'win32';
  releaseChannel: 'pilot';
  signing: Readonly<{
    publisher: null;
    status: 'unsigned-prototype';
    thumbprint: null;
    timestamped: false;
  }>;
}

export class UpdatePackageManifestValidationError extends Error {
  constructor() {
    super('The local update package manifest is invalid.');
    this.name = 'UpdatePackageManifestValidationError';
  }
}

export function parseUpdatePackageManifestBytes(
  bytes: Uint8Array,
): Readonly<LocalUnsignedPilotUpdatePackageManifest> {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > UPDATE_PACKAGE_MANIFEST_MAX_BYTES
    ) {
      throw new UpdatePackageManifestValidationError();
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(source);
    assertNoDuplicateJsonObjectKeys(source);
    return validateUpdatePackageManifest(value);
  } catch (error) {
    if (error instanceof UpdatePackageManifestValidationError) {
      throw error;
    }
    throw new UpdatePackageManifestValidationError();
  }
}

export function validateUpdatePackageManifest(
  value: unknown,
): Readonly<LocalUnsignedPilotUpdatePackageManifest> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !manifestFields.has(key)) ||
    Object.keys(value).length !== manifestFields.size ||
    value.manifestFormatVersion !== 1 ||
    value.appIdentity !== expectedAppIdentity ||
    typeof value.appVersion !== 'string' ||
    !semVerPattern.test(value.appVersion) ||
    typeof value.msiProductVersion !== 'string' ||
    !isMsiProductVersion(value.msiProductVersion) ||
    value.releaseChannel !== 'pilot' ||
    typeof value.buildRevision !== 'string' ||
    !revisionPattern.test(value.buildRevision) ||
    value.platform !== 'win32' ||
    value.architecture !== 'x64' ||
    value.packageKind !== 'windows-installer-msi' ||
    typeof value.packageFilename !== 'string' ||
    value.packageFilename !== `Eky-${value.appVersion}-x64.msi` ||
    !Number.isSafeInteger(value.packageSize) ||
    (value.packageSize as number) < 1 ||
    (value.packageSize as number) > UPDATE_PACKAGE_MAX_BYTES ||
    typeof value.packageSha256 !== 'string' ||
    !sha256Pattern.test(value.packageSha256) ||
    !isUnsignedPilotSigning(value.signing)
  ) {
    throw new UpdatePackageManifestValidationError();
  }

  return Object.freeze({
    appIdentity: 'Eky',
    appVersion: value.appVersion,
    architecture: 'x64',
    buildRevision: value.buildRevision,
    manifestFormatVersion: 1,
    msiProductVersion: value.msiProductVersion,
    packageFilename: value.packageFilename,
    packageKind: 'windows-installer-msi',
    packageSha256: value.packageSha256,
    packageSize: value.packageSize as number,
    platform: 'win32',
    releaseChannel: 'pilot',
    signing: Object.freeze({
      publisher: null,
      status: 'unsigned-prototype',
      thumbprint: null,
      timestamped: false,
    }),
  });
}

function isMsiProductVersion(value: string): boolean {
  const match = msiProductVersionPattern.exec(value);
  if (match === null) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const build = Number(match[3]);
  return major <= 255 && minor <= 255 && build <= 65_535;
}

function isUnsignedPilotSigning(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === signingFields.size &&
    Object.keys(value).every((key) => signingFields.has(key)) &&
    value.publisher === null &&
    value.status === 'unsigned-prototype' &&
    value.thumbprint === null &&
    value.timestamped === false
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoDuplicateJsonObjectKeys(source: string): void {
  let offset = 0;

  function skipWhitespace(): void {
    while (/\s/u.test(source[offset] ?? '')) {
      offset += 1;
    }
  }

  function readString(): string {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === '\\') {
        offset += 2;
        continue;
      }
      if (source[offset] === '"') {
        offset += 1;
        return JSON.parse(source.slice(start, offset)) as string;
      }
      offset += 1;
    }
    throw new UpdatePackageManifestValidationError();
  }

  function readValue(): void {
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
    while (offset < source.length && !/[\s,\]}]/u.test(source[offset] ?? '')) {
      offset += 1;
    }
  }

  function readObject(): void {
    const keys = new Set<string>();
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
        throw new UpdatePackageManifestValidationError();
      }
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') {
        throw new UpdatePackageManifestValidationError();
      }
      offset += 1;
      readValue();
      skipWhitespace();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') {
        throw new UpdatePackageManifestValidationError();
      }
      offset += 1;
    }
    throw new UpdatePackageManifestValidationError();
  }

  function readArray(): void {
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
        throw new UpdatePackageManifestValidationError();
      }
      offset += 1;
    }
    throw new UpdatePackageManifestValidationError();
  }

  readValue();
  skipWhitespace();
  if (offset !== source.length) {
    throw new UpdatePackageManifestValidationError();
  }
}
