import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import {
  backupEntryHeaderLength,
  backupPayloadHeaderLength,
} from './backupContainerConstants.js';
import {
  assertUniqueBackupEntryPaths,
  decodeBackupEntryHeader,
  decodeBackupPayloadHeader,
  type BackupContainerEntryDescriptor,
} from './backupContainerEntry.js';
import {
  backupStreamChunkBytes,
  maximumBackupCiphertextBytes,
  maximumBackupPathBytes,
  maximumManifestBytes,
} from './backupContainerLimits.js';
import type { BackupManifest } from './backupManifest.js';
import { decodeBackupManifest } from './backupManifestCodec.js';

export interface ParsedBackupContainerEntry
  extends BackupContainerEntryDescriptor {
  contentOffset: bigint;
}

export interface ParsedBackupPayload {
  entries: readonly ParsedBackupContainerEntry[];
  manifest: BackupManifest;
}

export async function readDecryptedBackupPayload(
  payloadPath: string,
): Promise<ParsedBackupPayload> {
  const metadata = await fileSystem.lstat(payloadPath, { bigint: true });
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0n ||
    metadata.size > maximumBackupCiphertextBytes
  ) {
    throw new Error('BACKUP_PAYLOAD_INVALID');
  }

  const file = await fileSystem.open(payloadPath, 'r');
  try {
    const payloadHeader = await readExact(
      file,
      backupPayloadHeaderLength,
      0n,
    );
    const { entryCount } = decodeBackupPayloadHeader(payloadHeader);
    const entries: ParsedBackupContainerEntry[] = [];
    let offset = BigInt(backupPayloadHeaderLength);
    let manifest: BackupManifest | undefined;

    for (let index = 0; index < entryCount; index += 1) {
      const header = await readExact(
        file,
        backupEntryHeaderLength,
        offset,
      );
      offset += BigInt(backupEntryHeaderLength);
      const pathLength = header.readUInt32BE(4);
      if (pathLength < 1 || pathLength > maximumBackupPathBytes) {
        throw new Error('BACKUP_ENTRY_INVALID');
      }
      const path = await readExact(file, pathLength, offset);
      offset += BigInt(pathLength);
      const descriptor = decodeBackupEntryHeader(header, path);
      const contentOffset = offset;
      const contentEnd = offset + descriptor.contentLength;
      if (contentEnd > metadata.size) {
        throw new Error('BACKUP_PAYLOAD_INVALID');
      }

      if (index === 0) {
        if (
          descriptor.type !== 'manifest' ||
          descriptor.logicalPath !== 'manifest.bin' ||
          descriptor.contentLength > BigInt(maximumManifestBytes)
        ) {
          throw new Error('BACKUP_MANIFEST_INVALID');
        }
        const content = await readExact(
          file,
          Number(descriptor.contentLength),
          contentOffset,
        );
        assertHash(content, descriptor.sha256);
        manifest = decodeBackupManifest(content);
      } else {
        if (descriptor.type === 'manifest') {
          throw new Error('BACKUP_MANIFEST_INVALID');
        }
        await assertFileRangeHash(
          file,
          contentOffset,
          descriptor.contentLength,
          descriptor.sha256,
        );
      }

      entries.push({ ...descriptor, contentOffset });
      offset = contentEnd;
    }

    if (offset !== metadata.size || manifest === undefined) {
      throw new Error('BACKUP_PAYLOAD_INVALID');
    }

    assertUniqueBackupEntryPaths(entries);
    assertDeterministicEntryOrder(entries.slice(1));
    assertManifestClosure(manifest, entries.slice(1));
    return { entries, manifest };
  } finally {
    await file.close();
  }
}

async function assertFileRangeHash(
  file: FileHandle,
  offset: bigint,
  byteLength: bigint,
  expectedSha256: string,
): Promise<void> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(backupStreamChunkBytes);
  let read = 0n;

  while (read < byteLength) {
    const requested = Number(
      byteLength - read > BigInt(buffer.byteLength)
        ? BigInt(buffer.byteLength)
        : byteLength - read,
    );
    const result = await file.read(
      buffer,
      0,
      requested,
      Number(offset + read),
    );
    if (result.bytesRead !== requested) {
      throw new Error('BACKUP_PAYLOAD_INVALID');
    }
    hash.update(buffer.subarray(0, result.bytesRead));
    read += BigInt(result.bytesRead);
  }

  if (hash.digest('hex') !== expectedSha256) {
    throw new Error('BACKUP_ENTRY_CHECKSUM_INVALID');
  }
}

async function readExact(
  file: FileHandle,
  byteLength: number,
  offset: bigint,
): Promise<Buffer> {
  const content = Buffer.allocUnsafe(byteLength);
  let read = 0;
  while (read < byteLength) {
    const result = await file.read(
      content,
      read,
      byteLength - read,
      Number(offset) + read,
    );
    if (result.bytesRead === 0) {
      throw new Error('BACKUP_PAYLOAD_INVALID');
    }
    read += result.bytesRead;
  }
  return content;
}

function assertHash(content: Buffer, expectedSha256: string): void {
  if (
    createHash('sha256').update(content).digest('hex') !== expectedSha256
  ) {
    throw new Error('BACKUP_ENTRY_CHECKSUM_INVALID');
  }
}

function assertDeterministicEntryOrder(
  entries: readonly ParsedBackupContainerEntry[],
): void {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (
      previous === undefined ||
      current === undefined ||
      previous.logicalPath.localeCompare(current.logicalPath, 'en') >= 0
    ) {
      throw new Error('BACKUP_ENTRY_ORDER_INVALID');
    }
  }
}

function assertManifestClosure(
  manifest: BackupManifest,
  entries: readonly ParsedBackupContainerEntry[],
): void {
  if (manifest.entries.length !== entries.length) {
    throw new Error('BACKUP_MANIFEST_CLOSURE_INVALID');
  }

  for (let index = 0; index < entries.length; index += 1) {
    const expected = manifest.entries[index];
    const actual = entries[index];
    if (
      expected === undefined ||
      actual === undefined ||
      expected.contentLength !== actual.contentLength ||
      expected.logicalPath !== actual.logicalPath ||
      expected.sha256 !== actual.sha256 ||
      expected.type !== actual.type
    ) {
      throw new Error('BACKUP_MANIFEST_CLOSURE_INVALID');
    }
  }
}
