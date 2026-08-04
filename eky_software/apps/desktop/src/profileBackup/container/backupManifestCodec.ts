import {
  backupManifestMagic,
  backupManifestVersion,
} from './backupContainerConstants.js';
import {
  assertUniqueBackupEntryPaths,
  decodeBackupEntryHeader,
  encodeBackupEntryHeader,
  type BackupContainerEntryDescriptor,
} from './backupContainerEntry.js';
import {
  maximumBackupEntryCount,
  maximumBackupPathBytes,
  maximumManifestBytes,
  maximumManifestTextBytes,
} from './backupContainerLimits.js';
import type { BackupManifest } from './backupManifest.js';

const manifestFixedHeaderLength = 32;
const manifestEntryHeaderLength = 48;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeBackupManifest(manifest: BackupManifest): Buffer {
  validateBackupManifest(manifest);
  const appVersion = encodeText(manifest.appVersion);
  const profileId = encodeText(manifest.profileId);
  const migrationChainIdentity = encodeText(
    manifest.migrationChainIdentity,
  );
  const entryParts = manifest.entries.flatMap((entry) => {
    const encoded = encodeBackupEntryHeader(entry);
    return [encoded.header, encoded.path];
  });
  const totalByteLength =
    manifestFixedHeaderLength +
    appVersion.byteLength +
    profileId.byteLength +
    migrationChainIdentity.byteLength +
    entryParts.reduce((total, part) => total + part.byteLength, 0);

  if (totalByteLength > maximumManifestBytes) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }

  const header = Buffer.alloc(manifestFixedHeaderLength);
  backupManifestMagic.copy(header, 0);
  header.writeUInt16BE(backupManifestVersion, 8);
  header.writeUInt16BE(manifestFixedHeaderLength, 10);
  header.writeBigUInt64BE(manifest.createdAtEpochMilliseconds, 12);
  header.writeUInt16BE(appVersion.byteLength, 20);
  header.writeUInt16BE(profileId.byteLength, 22);
  header.writeUInt16BE(migrationChainIdentity.byteLength, 24);
  header.writeUInt32BE(manifest.entries.length, 28);

  return Buffer.concat([
    header,
    appVersion,
    profileId,
    migrationChainIdentity,
    ...entryParts,
  ]);
}

export function decodeBackupManifest(content: Buffer): BackupManifest {
  if (
    content.byteLength < manifestFixedHeaderLength ||
    content.byteLength > maximumManifestBytes ||
    !content.subarray(0, backupManifestMagic.byteLength).equals(
      backupManifestMagic,
    ) ||
    content.readUInt16BE(8) !== backupManifestVersion ||
    content.readUInt16BE(10) !== manifestFixedHeaderLength ||
    content.readUInt16BE(26) !== 0
  ) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }

  const appVersionLength = content.readUInt16BE(20);
  const profileIdLength = content.readUInt16BE(22);
  const migrationIdentityLength = content.readUInt16BE(24);
  const entryCount = content.readUInt32BE(28);

  if (
    entryCount < 1 ||
    entryCount > maximumBackupEntryCount - 1 ||
    appVersionLength < 1 ||
    profileIdLength < 1 ||
    migrationIdentityLength < 1 ||
    appVersionLength > maximumManifestTextBytes ||
    profileIdLength > maximumManifestTextBytes ||
    migrationIdentityLength > maximumManifestTextBytes
  ) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }

  let offset = manifestFixedHeaderLength;
  const appVersion = readText(content, offset, appVersionLength);
  offset += appVersionLength;
  const profileId = readText(content, offset, profileIdLength);
  offset += profileIdLength;
  const migrationChainIdentity = readText(
    content,
    offset,
    migrationIdentityLength,
  );
  offset += migrationIdentityLength;

  const entries: BackupContainerEntryDescriptor[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const headerEnd = offset + manifestEntryHeaderLength;
    if (headerEnd > content.byteLength) {
      throw new Error('BACKUP_MANIFEST_INVALID');
    }
    const header = content.subarray(offset, headerEnd);
    const pathLength = header.readUInt32BE(4);
    if (pathLength < 1 || pathLength > maximumBackupPathBytes) {
      throw new Error('BACKUP_MANIFEST_INVALID');
    }
    offset = headerEnd;
    const pathEnd = offset + pathLength;
    if (pathEnd > content.byteLength) {
      throw new Error('BACKUP_MANIFEST_INVALID');
    }
    entries.push(
      decodeBackupEntryHeader(header, content.subarray(offset, pathEnd)),
    );
    offset = pathEnd;
  }

  if (offset !== content.byteLength) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }

  const manifest: BackupManifest = {
    appVersion,
    createdAtEpochMilliseconds: content.readBigUInt64BE(12),
    entries,
    migrationChainIdentity,
    profileId,
  };
  validateBackupManifest(manifest);
  return manifest;
}

export function validateBackupManifest(manifest: BackupManifest): void {
  if (
    manifest.createdAtEpochMilliseconds <= 0n ||
    manifest.createdAtEpochMilliseconds >
      BigInt(Number.MAX_SAFE_INTEGER) ||
    manifest.entries.length < 1 ||
    manifest.entries.length > maximumBackupEntryCount - 1
  ) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }

  validateText(manifest.appVersion);
  validateText(manifest.profileId);
  validateText(manifest.migrationChainIdentity);
  assertUniqueBackupEntryPaths(manifest.entries);

  if (manifest.entries.some((entry) => entry.type === 'manifest')) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
}

function encodeText(value: string): Buffer {
  validateText(value);
  return Buffer.from(value, 'utf8');
}

function readText(
  content: Buffer,
  offset: number,
  length: number,
): string {
  const end = offset + length;
  if (end > content.byteLength) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }

  try {
    const value = utf8Decoder.decode(content.subarray(offset, end));
    validateText(value);
    return value;
  } catch {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
}

function validateText(value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  if (
    value === '' ||
    bytes.byteLength > maximumManifestTextBytes ||
    bytes.toString('utf8') !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
}
