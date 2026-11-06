import { createDecipheriv } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

import { backupStreamChunkBytes } from '../container/backupContainerLimits.js';
import { captureProfileSnapshotCleanupGuard } from '../profileSnapshotInspectionPort.js';
import { RecoveryPointCleanupError } from './recoveryPointOperationError.js';
import {
  decodeRecoveryPointContainerHeader,
  expectedRecoveryPointContainerByteLength,
  recoveryPointAuthenticationTagLength,
  recoveryPointContainerHeaderLength,
  recoveryPointDataKeyLength,
  type RecoveryPointContainerHeader,
} from './recoveryPointContainerHeader.js';

export async function decryptRecoveryPointPayload(input: {
  containerPath: string;
  dataKey: Buffer;
  quarantinePath: string;
  assertCleanupCurrent?: () => void;
}): Promise<RecoveryPointContainerHeader> {
  const assertCleanupCurrent = captureProfileSnapshotCleanupGuard(input.assertCleanupCurrent);
  if (input.dataKey.byteLength !== recoveryPointDataKeyLength) {
    throw new Error('RECOVERY_POINT_KEY_INVALID');
  }
  const pathMetadata = await fileSystem.lstat(input.containerPath, {
    bigint: true,
  });
  if (
    !pathMetadata.isFile() ||
    pathMetadata.isSymbolicLink() ||
    pathMetadata.nlink !== 1n
  ) {
    throw new Error('RECOVERY_POINT_FILE_INVALID');
  }
  const realPath = await fileSystem.realpath(input.containerPath);
  if (!pathsAreEqual(realPath, input.containerPath)) {
    throw new Error('RECOVERY_POINT_FILE_INVALID');
  }

  const source = await fileSystem.open(input.containerPath, 'r');
  const key = Buffer.from(input.dataKey);
  let destination: FileHandle | undefined;
  let destinationCreated = false;
  let failure: { error: unknown } | undefined;

  try {
    const sourceMetadata = await source.stat({ bigint: true });
    assertSameFileIdentity(pathMetadata, sourceMetadata);
    const authenticatedHeader = await readExact(
      source,
      recoveryPointContainerHeaderLength,
      0,
    );
    const header = decodeRecoveryPointContainerHeader(
      authenticatedHeader,
    );
    if (
      expectedRecoveryPointContainerByteLength(header) !==
      sourceMetadata.size
    ) {
      throw new Error('RECOVERY_POINT_LENGTH_INVALID');
    }

    const authenticationTagOffset =
      recoveryPointContainerHeaderLength +
      Number(header.ciphertextLength);
    const authenticationTag = await readExact(
      source,
      recoveryPointAuthenticationTagLength,
      authenticationTagOffset,
    );
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      header.nonce,
      { authTagLength: recoveryPointAuthenticationTagLength },
    );
    decipher.setAAD(authenticatedHeader);
    decipher.setAuthTag(authenticationTag);
    destination = await fileSystem.open(
      input.quarantinePath,
      'wx',
      0o600,
    );
    destinationCreated = true;

    const buffer = Buffer.allocUnsafe(backupStreamChunkBytes);
    let remaining = header.ciphertextLength;
    let sourceOffset = recoveryPointContainerHeaderLength;
    let destinationOffset = 0;

    while (remaining > 0n) {
      const requested = Number(
        remaining > BigInt(buffer.byteLength)
          ? BigInt(buffer.byteLength)
          : remaining,
      );
      const result = await source.read(
        buffer,
        0,
        requested,
        sourceOffset,
      );
      if (result.bytesRead !== requested) {
        throw new Error('RECOVERY_POINT_LENGTH_INVALID');
      }
      const decrypted = decipher.update(
        buffer.subarray(0, result.bytesRead),
      );
      await writeComplete(
        destination,
        decrypted,
        destinationOffset,
      );
      sourceOffset += result.bytesRead;
      destinationOffset += decrypted.byteLength;
      remaining -= BigInt(result.bytesRead);
    }

    let finalBytes: Buffer;
    try {
      finalBytes = decipher.final();
    } catch {
      throw new Error('RECOVERY_POINT_AUTHENTICATION_FAILED');
    }
    await writeComplete(destination, finalBytes, destinationOffset);
    destinationOffset += finalBytes.byteLength;
    if (BigInt(destinationOffset) !== header.ciphertextLength) {
      throw new Error('RECOVERY_POINT_PAYLOAD_INVALID');
    }
    assertSameFileIdentity(
      sourceMetadata,
      await source.stat({ bigint: true }),
    );
    await destination.sync();
    if (assertCleanupCurrent === undefined) {
      await destination.close();
      destination = undefined;
    } else {
      const closing = destination;
      destination = undefined;
      try {
        await closing.close();
      } catch (closeError) {
        throw new RecoveryPointCleanupError(closeError);
      }
    }
    await fileSystem.chmod(input.quarantinePath, 0o400);
    return header;
  } catch (error) {
    if (assertCleanupCurrent !== undefined) {
      failure = { error };
      try {
        await destination?.close();
      } catch (closeError) {
        failure = { error: new RecoveryPointCleanupError(new AggregateError(
          [error, closeError], 'RECOVERY_POINT_WRITE_FAILED')) };
      }
      throw failure.error;
    }
    await destination?.close().catch(() => undefined);
    if (destinationCreated) {
      try {
        await fileSystem.rm(input.quarantinePath, { force: true });
      } catch { /* Retain the failed operation and its original cause. */ }
    }
    throw error;
  } finally {
    key.fill(0);
    if (assertCleanupCurrent === undefined) {
      await source.close();
    } else {
      try {
        await source.close();
      } catch (closeError) {
        throw new RecoveryPointCleanupError(failure === undefined ? closeError : new AggregateError(
          [failure.error, closeError], 'RECOVERY_POINT_READ_FAILED'));
      }
      if (failure !== undefined && destinationCreated && !(failure.error instanceof RecoveryPointCleanupError)) {
        try {
          assertCleanupCurrent();
          await fileSystem.rm(input.quarantinePath, { force: true });
        } catch { /* Retain the failed operation and its original cause. */ }
      }
    }
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
      throw new Error('RECOVERY_POINT_LENGTH_INVALID');
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
      throw new Error('RECOVERY_POINT_WRITE_FAILED');
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
    expected.nlink !== actual.nlink ||
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  ) {
    throw new Error('RECOVERY_POINT_FILE_CHANGED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
