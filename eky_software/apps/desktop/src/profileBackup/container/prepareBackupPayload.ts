import { createHash } from 'node:crypto';
import {
  createReadStream,
  promises as fileSystem,
  type BigIntStats,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  backupEntryHeaderLength,
  backupPayloadHeaderLength,
} from './backupContainerConstants.js';
import {
  assertUniqueBackupEntryPaths,
  encodeBackupEntryHeader,
  encodeBackupPayloadHeader,
  type BackupContainerEntryDescriptor,
} from './backupContainerEntry.js';
import {
  maximumBackupCiphertextBytes,
  maximumBackupEntryCount,
} from './backupContainerLimits.js';
import type { BackupManifest } from './backupManifest.js';
import { encodeBackupManifest } from './backupManifestCodec.js';

const manifestLogicalPath = 'manifest.bin';

export interface BackupPayloadSourceEntry
  extends BackupContainerEntryDescriptor {
  sourcePath: string;
}

export interface PreparedBackupPayload {
  manifest: BackupManifest;
  plaintext: AsyncIterable<Buffer>;
  plaintextLength: bigint;
}

export async function prepareBackupPayload(input: {
  entries: readonly BackupPayloadSourceEntry[];
  manifest: Omit<BackupManifest, 'entries'>;
}): Promise<PreparedBackupPayload> {
  if (
    input.entries.length < 1 ||
    input.entries.length >= maximumBackupEntryCount
  ) {
    throw new Error('BACKUP_PAYLOAD_INVALID');
  }

  const entries = [...input.entries].sort(compareEntries);
  const descriptors = entries.map(toDescriptor);
  const manifest: BackupManifest = {
    ...input.manifest,
    entries: descriptors,
  };
  const manifestContent = encodeBackupManifest(manifest);
  const manifestDescriptor: BackupContainerEntryDescriptor = {
    contentLength: BigInt(manifestContent.byteLength),
    logicalPath: manifestLogicalPath,
    sha256: createHash('sha256').update(manifestContent).digest('hex'),
    type: 'manifest',
  };
  assertUniqueBackupEntryPaths([manifestDescriptor, ...descriptors]);

  const sourceIdentities = new Map<string, BigIntStats>();
  for (const entry of entries) {
    sourceIdentities.set(
      entry.logicalPath,
      await inspectSourceEntry(entry),
    );
  }

  return {
    manifest,
    plaintext: createPayload({
      entries,
      manifestContent,
      manifestDescriptor,
      sourceIdentities,
    }),
    plaintextLength: calculatePayloadLength([
      manifestDescriptor,
      ...descriptors,
    ]),
  };
}

function calculatePayloadLength(
  entries: readonly BackupContainerEntryDescriptor[],
): bigint {
  const total = entries.reduce(
    (sum, entry) =>
      sum +
      BigInt(backupEntryHeaderLength) +
      BigInt(Buffer.byteLength(entry.logicalPath, 'utf8')) +
      entry.contentLength,
    BigInt(backupPayloadHeaderLength),
  );
  if (total <= 0n || total > maximumBackupCiphertextBytes) {
    throw new Error('BACKUP_PAYLOAD_LENGTH_INVALID');
  }
  return total;
}

async function* createPayload(input: {
  entries: readonly BackupPayloadSourceEntry[];
  manifestContent: Buffer;
  manifestDescriptor: BackupContainerEntryDescriptor;
  sourceIdentities: ReadonlyMap<string, BigIntStats>;
}): AsyncGenerator<Buffer> {
  yield encodeBackupPayloadHeader(input.entries.length + 1);
  const manifestRecord = encodeBackupEntryHeader(
    input.manifestDescriptor,
  );
  yield manifestRecord.header;
  yield manifestRecord.path;
  yield input.manifestContent;

  for (const entry of input.entries) {
    const record = encodeBackupEntryHeader(entry);
    yield record.header;
    yield record.path;

    const expectedIdentity = input.sourceIdentities.get(
      entry.logicalPath,
    );
    if (expectedIdentity === undefined) {
      throw new Error('BACKUP_SOURCE_CHANGED');
    }
    const hash = createHash('sha256');
    let byteLength = 0n;

    for await (const chunk of createReadStream(entry.sourcePath)) {
      const buffer = chunk as Buffer;
      hash.update(buffer);
      byteLength += BigInt(buffer.byteLength);
      if (byteLength > entry.contentLength) {
        throw new Error('BACKUP_SOURCE_CHANGED');
      }
      yield buffer;
    }

    const finalMetadata = await fileSystem.stat(entry.sourcePath, {
      bigint: true,
    });
    assertSameFileIdentity(expectedIdentity, finalMetadata);
    if (
      byteLength !== entry.contentLength ||
      hash.digest('hex') !== entry.sha256
    ) {
      throw new Error('BACKUP_SOURCE_CHANGED');
    }
  }
}

async function inspectSourceEntry(
  entry: BackupPayloadSourceEntry,
): Promise<BigIntStats> {
  const pathMetadata = await fileSystem.lstat(entry.sourcePath, {
    bigint: true,
  });
  if (
    !pathMetadata.isFile() ||
    pathMetadata.isSymbolicLink() ||
    pathMetadata.nlink !== 1n
  ) {
    throw new Error('BACKUP_SOURCE_INVALID');
  }
  const realPath = await fileSystem.realpath(entry.sourcePath);
  if (!pathsAreEqual(realPath, entry.sourcePath)) {
    throw new Error('BACKUP_SOURCE_INVALID');
  }
  if (pathMetadata.size !== entry.contentLength) {
    throw new Error('BACKUP_SOURCE_CHANGED');
  }

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(entry.sourcePath)) {
    hash.update(chunk as Buffer);
  }
  if (hash.digest('hex') !== entry.sha256) {
    throw new Error('BACKUP_SOURCE_CHANGED');
  }
  return pathMetadata;
}

function toDescriptor(
  entry: BackupPayloadSourceEntry,
): BackupContainerEntryDescriptor {
  return {
    contentLength: entry.contentLength,
    logicalPath: entry.logicalPath,
    sha256: entry.sha256,
    type: entry.type,
  };
}

function compareEntries(
  first: BackupPayloadSourceEntry,
  second: BackupPayloadSourceEntry,
): number {
  return (
    first.logicalPath.localeCompare(second.logicalPath, 'en') ||
    first.type.localeCompare(second.type, 'en')
  );
}

function assertSameFileIdentity(
  expected: BigIntStats,
  actual: BigIntStats,
): void {
  if (
    !actual.isFile() ||
    actual.isSymbolicLink() ||
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.nlink !== actual.nlink ||
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  ) {
    throw new Error('BACKUP_SOURCE_CHANGED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
