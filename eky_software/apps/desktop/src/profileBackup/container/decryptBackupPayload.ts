import { createDecipheriv, createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  backupAuthenticationTagLength,
  backupContainerHeaderLength,
} from './backupContainerConstants.js';
import {
  decodeBackupContainerHeader,
  expectedBackupContainerByteLength,
  type BackupContainerHeader,
} from './backupContainerHeader.js';
import { backupStreamChunkBytes } from './backupContainerLimits.js';
import { deriveBackupKey } from './deriveBackupKey.js';

export interface DecryptBackupPayloadResult {
  containerSha256: string;
  header: BackupContainerHeader;
  plaintextByteLength: bigint;
}

export async function decryptBackupPayload(input: {
  containerPath: string;
  password: string;
  quarantinePath: string;
}): Promise<DecryptBackupPayloadResult> {
  const pathMetadata = await fileSystem.lstat(input.containerPath, {
    bigint: true,
  });
  if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
    throw new Error('BACKUP_CONTAINER_FILE_INVALID');
  }

  const realPath = await fileSystem.realpath(input.containerPath);
  if (!pathsAreEqual(realPath, input.containerPath)) {
    throw new Error('BACKUP_CONTAINER_FILE_INVALID');
  }

  const source = await fileSystem.open(input.containerPath, 'r');
  let destination: FileHandle | undefined;
  let destinationCreated = false;
  let key: Buffer | undefined;

  try {
    const sourceMetadata = await source.stat({ bigint: true });
    assertSameFileIdentity(pathMetadata, sourceMetadata);
    const encodedHeader = await readExact(
      source,
      backupContainerHeaderLength,
      0,
    );
    const containerHash = createHash('sha256').update(encodedHeader);
    const header = decodeBackupContainerHeader(encodedHeader);

    if (
      expectedBackupContainerByteLength(header) !== sourceMetadata.size
    ) {
      throw new Error('BACKUP_CONTAINER_LENGTH_INVALID');
    }

    const authenticationTagOffset =
      backupContainerHeaderLength + Number(header.ciphertextLength);
    const authenticationTag = await readExact(
      source,
      backupAuthenticationTagLength,
      authenticationTagOffset,
    );
    key = await deriveBackupKey({
      kdfProfileId: header.kdfProfileId,
      password: input.password,
      salt: header.salt,
    });

    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      header.nonce,
      { authTagLength: backupAuthenticationTagLength },
    );
    decipher.setAAD(encodedHeader);
    decipher.setAuthTag(authenticationTag);
    destination = await fileSystem.open(
      input.quarantinePath,
      'wx',
      0o600,
    );
    destinationCreated = true;

    const buffer = Buffer.allocUnsafe(backupStreamChunkBytes);
    let remaining = header.ciphertextLength;
    let sourceOffset = backupContainerHeaderLength;
    let destinationOffset = 0;

    while (remaining > 0n) {
      const requested = Number(
        remaining > BigInt(buffer.byteLength)
          ? BigInt(buffer.byteLength)
          : remaining,
      );
      const { bytesRead } = await source.read(
        buffer,
        0,
        requested,
        sourceOffset,
      );
      if (bytesRead !== requested) {
        throw new Error('BACKUP_CONTAINER_LENGTH_INVALID');
      }
      containerHash.update(buffer.subarray(0, bytesRead));
      const decrypted = decipher.update(buffer.subarray(0, bytesRead));
      await writeComplete(destination, decrypted, destinationOffset);
      sourceOffset += bytesRead;
      destinationOffset += decrypted.byteLength;
      remaining -= BigInt(bytesRead);
    }

    let finalBytes: Buffer;
    try {
      finalBytes = decipher.final();
    } catch {
      throw new Error('BACKUP_AUTHENTICATION_FAILED');
    }
    await writeComplete(destination, finalBytes, destinationOffset);
    destinationOffset += finalBytes.byteLength;

    assertSameFileIdentity(
      sourceMetadata,
      await source.stat({ bigint: true }),
    );
    if (BigInt(destinationOffset) !== header.ciphertextLength) {
      throw new Error('BACKUP_PAYLOAD_LENGTH_INVALID');
    }

    await destination.sync();
    await destination.close();
    destination = undefined;
    await fileSystem.chmod(input.quarantinePath, 0o400);
    containerHash.update(authenticationTag);
    return {
      containerSha256: containerHash.digest('hex'),
      header,
      plaintextByteLength: BigInt(destinationOffset),
    };
  } catch (error) {
    await destination?.close().catch(() => undefined);
    if (destinationCreated) {
      await fileSystem
        .rm(input.quarantinePath, { force: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    key?.fill(0);
    await source.close();
  }
}

async function readExact(
  file: FileHandle,
  byteLength: number,
  position: number,
): Promise<Buffer> {
  const result = Buffer.allocUnsafe(byteLength);
  let read = 0;
  while (read < byteLength) {
    const chunk = await file.read(
      result,
      read,
      byteLength - read,
      position + read,
    );
    if (chunk.bytesRead === 0) {
      throw new Error('BACKUP_CONTAINER_LENGTH_INVALID');
    }
    read += chunk.bytesRead;
  }
  return result;
}

async function writeComplete(
  file: FileHandle,
  content: Buffer,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < content.byteLength) {
    const result = await file.write(
      content,
      written,
      content.byteLength - written,
      position + written,
    );
    if (result.bytesWritten === 0) {
      throw new Error('BACKUP_WRITE_FAILED');
    }
    written += result.bytesWritten;
  }
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
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  ) {
    throw new Error('BACKUP_CONTAINER_FILE_CHANGED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
