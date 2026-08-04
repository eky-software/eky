import { createCipheriv, randomBytes } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import { maximumBackupCiphertextBytes } from '../container/backupContainerLimits.js';
import {
  encodeRecoveryPointContainerHeader,
  recoveryPointAuthenticationTagLength,
  recoveryPointCipherProfileId,
  recoveryPointContainerVersion,
  recoveryPointDataKeyLength,
  recoveryPointKeyModeId,
  recoveryPointNonceLength,
  type RecoveryPointContainerHeader,
} from './recoveryPointContainerHeader.js';

export async function encryptRecoveryPointPayload(input: {
  dataKey: Buffer;
  destinationPath: string;
  nonce?: Buffer;
  plaintext: AsyncIterable<Buffer>;
  plaintextLength: bigint;
}): Promise<{
  byteLength: bigint;
  header: RecoveryPointContainerHeader;
}> {
  if (
    input.dataKey.byteLength !== recoveryPointDataKeyLength ||
    input.plaintextLength <= 0n ||
    input.plaintextLength > maximumBackupCiphertextBytes
  ) {
    throw new Error('RECOVERY_POINT_ENCRYPTION_INVALID');
  }

  const key = Buffer.from(input.dataKey);
  const nonce = Buffer.from(
    input.nonce ?? randomBytes(recoveryPointNonceLength),
  );
  const header: RecoveryPointContainerHeader = {
    cipherProfileId: recoveryPointCipherProfileId,
    ciphertextLength: input.plaintextLength,
    containerVersion: recoveryPointContainerVersion,
    keyModeId: recoveryPointKeyModeId,
    nonce,
  };
  const authenticatedHeader =
    encodeRecoveryPointContainerHeader(header);
  let destination: FileHandle | undefined;
  let destinationCreated = false;

  try {
    destination = await fileSystem.open(
      input.destinationPath,
      'wx',
      0o600,
    );
    destinationCreated = true;
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: recoveryPointAuthenticationTagLength,
    });
    cipher.setAAD(authenticatedHeader);

    let plaintextBytes = 0n;
    let outputOffset = 0;
    await writeComplete(
      destination,
      authenticatedHeader,
      outputOffset,
    );
    outputOffset += authenticatedHeader.byteLength;

    for await (const chunk of input.plaintext) {
      if (!Buffer.isBuffer(chunk) || chunk.byteLength === 0) {
        throw new Error('RECOVERY_POINT_PAYLOAD_INVALID');
      }
      plaintextBytes += BigInt(chunk.byteLength);
      if (plaintextBytes > input.plaintextLength) {
        throw new Error('RECOVERY_POINT_PAYLOAD_INVALID');
      }
      const encrypted = cipher.update(chunk);
      await writeComplete(destination, encrypted, outputOffset);
      outputOffset += encrypted.byteLength;
    }

    if (plaintextBytes !== input.plaintextLength) {
      throw new Error('RECOVERY_POINT_PAYLOAD_INVALID');
    }

    const finalBytes = cipher.final();
    await writeComplete(destination, finalBytes, outputOffset);
    outputOffset += finalBytes.byteLength;
    const authenticationTag = cipher.getAuthTag();
    if (
      authenticationTag.byteLength !==
      recoveryPointAuthenticationTagLength
    ) {
      throw new Error('RECOVERY_POINT_ENCRYPTION_FAILED');
    }
    await writeComplete(
      destination,
      authenticationTag,
      outputOffset,
    );
    outputOffset += authenticationTag.byteLength;
    await destination.sync();
    await destination.close();
    destination = undefined;
    await fileSystem.chmod(input.destinationPath, 0o400);
    return { byteLength: BigInt(outputOffset), header };
  } catch (error) {
    await destination?.close().catch(() => undefined);
    if (destinationCreated) {
      await fileSystem
        .rm(input.destinationPath, { force: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    key.fill(0);
  }
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
