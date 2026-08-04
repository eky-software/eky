import {
  backupEntryHeaderLength,
  backupPayloadHeaderLength,
  backupPayloadMagic,
  backupPayloadVersion,
} from './backupContainerConstants.js';
import {
  maximumBackupEntryBytes,
  maximumBackupEntryCount,
  maximumBackupPathBytes,
} from './backupContainerLimits.js';

const sha256Pattern = /^[a-f0-9]{64}$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export type BackupContainerEntryType =
  | 'manifest'
  | 'database'
  | 'artifactCatalog'
  | 'businessArtifact';

export interface BackupContainerEntryDescriptor {
  contentLength: bigint;
  logicalPath: string;
  sha256: string;
  type: BackupContainerEntryType;
}

const entryTypeIds: Record<BackupContainerEntryType, number> = {
  manifest: 1,
  database: 2,
  artifactCatalog: 3,
  businessArtifact: 4,
};

export function encodeBackupPayloadHeader(entryCount: number): Buffer {
  if (
    !Number.isSafeInteger(entryCount) ||
    entryCount < 1 ||
    entryCount > maximumBackupEntryCount
  ) {
    throw new Error('BACKUP_PAYLOAD_INVALID');
  }

  const header = Buffer.alloc(backupPayloadHeaderLength);
  backupPayloadMagic.copy(header, 0);
  header.writeUInt16BE(backupPayloadVersion, 8);
  header.writeUInt16BE(backupPayloadHeaderLength, 10);
  header.writeUInt32BE(entryCount, 12);
  return header;
}

export function decodeBackupPayloadHeader(header: Buffer): {
  entryCount: number;
} {
  if (
    header.byteLength !== backupPayloadHeaderLength ||
    !header.subarray(0, backupPayloadMagic.byteLength).equals(
      backupPayloadMagic,
    ) ||
    header.readUInt16BE(8) !== backupPayloadVersion ||
    header.readUInt16BE(10) !== backupPayloadHeaderLength
  ) {
    throw new Error('BACKUP_PAYLOAD_INVALID');
  }

  const entryCount = header.readUInt32BE(12);
  if (entryCount < 1 || entryCount > maximumBackupEntryCount) {
    throw new Error('BACKUP_PAYLOAD_INVALID');
  }
  return { entryCount };
}

export function encodeBackupEntryHeader(
  descriptor: BackupContainerEntryDescriptor,
): { header: Buffer; path: Buffer } {
  validateBackupEntryDescriptor(descriptor);
  const path = Buffer.from(descriptor.logicalPath, 'utf8');
  const header = Buffer.alloc(backupEntryHeaderLength);

  header.writeUInt8(entryTypeIds[descriptor.type], 0);
  header.writeUInt32BE(path.byteLength, 4);
  header.writeBigUInt64BE(descriptor.contentLength, 8);
  Buffer.from(descriptor.sha256, 'hex').copy(header, 16);
  return { header, path };
}

export function decodeBackupEntryHeader(
  header: Buffer,
  path: Buffer,
): BackupContainerEntryDescriptor {
  if (
    header.byteLength !== backupEntryHeaderLength ||
    header.readUInt8(1) !== 0 ||
    header.readUInt16BE(2) !== 0 ||
    header.readUInt32BE(4) !== path.byteLength
  ) {
    throw new Error('BACKUP_ENTRY_INVALID');
  }

  let logicalPath: string;
  try {
    logicalPath = utf8Decoder.decode(path);
  } catch {
    throw new Error('BACKUP_ENTRY_INVALID');
  }

  const descriptor: BackupContainerEntryDescriptor = {
    contentLength: header.readBigUInt64BE(8),
    logicalPath,
    sha256: header.subarray(16, 48).toString('hex'),
    type: readEntryType(header.readUInt8(0)),
  };
  validateBackupEntryDescriptor(descriptor);
  return descriptor;
}

export function validateBackupEntryDescriptor(
  descriptor: BackupContainerEntryDescriptor,
): void {
  const path = Buffer.from(descriptor.logicalPath, 'utf8');

  if (
    !Object.hasOwn(entryTypeIds, descriptor.type) ||
    descriptor.contentLength < 0n ||
    descriptor.contentLength > maximumBackupEntryBytes ||
    !sha256Pattern.test(descriptor.sha256) ||
    path.byteLength < 1 ||
    path.byteLength > maximumBackupPathBytes ||
    path.toString('utf8') !== descriptor.logicalPath ||
    !isSafeLogicalPath(descriptor.logicalPath)
  ) {
    throw new Error('BACKUP_ENTRY_INVALID');
  }
}

export function assertUniqueBackupEntryPaths(
  descriptors: readonly BackupContainerEntryDescriptor[],
): void {
  const caseFoldedPaths = new Set<string>();

  for (const descriptor of descriptors) {
    validateBackupEntryDescriptor(descriptor);
    const folded = descriptor.logicalPath.toLowerCase();
    if (caseFoldedPaths.has(folded)) {
      throw new Error('BACKUP_ENTRY_PATH_COLLISION');
    }
    caseFoldedPaths.add(folded);
  }
}

function isSafeLogicalPath(path: string): boolean {
  const segments = path.split('/');
  return (
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !/^[a-zA-Z]:/u.test(path) &&
    !/[\u0000-\u001f\u007f]/u.test(path) &&
    segments.every(
      (segment) =>
        segment !== '' && segment !== '.' && segment !== '..',
    )
  );
}

function readEntryType(value: number): BackupContainerEntryType {
  for (const [type, id] of Object.entries(entryTypeIds)) {
    if (id === value) {
      return type as BackupContainerEntryType;
    }
  }
  throw new Error('BACKUP_ENTRY_INVALID');
}

