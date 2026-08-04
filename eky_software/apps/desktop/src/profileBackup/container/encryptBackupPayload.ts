import {
  createCipheriv,
  randomBytes,
} from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import {
  backupAuthenticationTagLength,
  backupCipherProfileId,
  backupContainerVersion,
  backupKdfProfileId,
  backupNonceLength,
  backupSaltLength,
} from './backupContainerConstants.js';
import {
  encodeBackupContainerHeader,
  type BackupContainerHeader,
} from './backupContainerHeader.js';
import { maximumBackupCiphertextBytes } from './backupContainerLimits.js';
import { deriveBackupKey } from './deriveBackupKey.js';

export interface EncryptBackupPayloadResult {
  byteLength: bigint;
  header: BackupContainerHeader;
}

export async function encryptBackupPayload(input: {
  destinationPath: string;
  nonce?: Buffer;
  password: string;
  plaintext: AsyncIterable<Buffer>;
  plaintextLength: bigint;
  salt?: Buffer;
}): Promise<EncryptBackupPayloadResult> {
  if (
    input.plaintextLength <= 0n ||
    input.plaintextLength > maximumBackupCiphertextBytes
  ) {
    throw new Error('BACKUP_PAYLOAD_LENGTH_INVALID');
  }

  const salt = Buffer.from(
    input.salt ?? randomBytes(backupSaltLength),
  );
  const nonce = Buffer.from(
    input.nonce ?? randomBytes(backupNonceLength),
  );
  const header: BackupContainerHeader = {
    cipherProfileId: backupCipherProfileId,
    ciphertextLength: input.plaintextLength,
    containerVersion: backupContainerVersion,
    kdfProfileId: backupKdfProfileId,
    nonce,
    salt,
  };
  const encodedHeader = encodeBackupContainerHeader(header);
  const key = await deriveBackupKey({
    kdfProfileId: header.kdfProfileId,
    password: input.password,
    salt,
  });
  let destination: FileHandle | undefined;
  let destinationCreated = false;

  try {
    destination = await fileSystem.open(input.destinationPath, 'wx', 0o600);
    destinationCreated = true;
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: backupAuthenticationTagLength,
    });
    cipher.setAAD(encodedHeader);

    let plaintextBytes = 0n;
    let outputOffset = 0;
    await writeComplete(destination, encodedHeader, outputOffset);
    outputOffset += encodedHeader.byteLength;

    for await (const chunk of input.plaintext) {
      if (!Buffer.isBuffer(chunk) || chunk.byteLength === 0) {
        throw new Error('BACKUP_PAYLOAD_INVALID');
      }
      plaintextBytes += BigInt(chunk.byteLength);
      if (plaintextBytes > input.plaintextLength) {
        throw new Error('BACKUP_PAYLOAD_LENGTH_INVALID');
      }
      const encrypted = cipher.update(chunk);
      await writeComplete(destination, encrypted, outputOffset);
      outputOffset += encrypted.byteLength;
    }

    if (plaintextBytes !== input.plaintextLength) {
      throw new Error('BACKUP_PAYLOAD_LENGTH_INVALID');
    }

    const finalBytes = cipher.final();
    await writeComplete(destination, finalBytes, outputOffset);
    outputOffset += finalBytes.byteLength;
    const authenticationTag = cipher.getAuthTag();
    if (
      authenticationTag.byteLength !== backupAuthenticationTagLength
    ) {
      throw new Error('BACKUP_ENCRYPTION_FAILED');
    }
    await writeComplete(destination, authenticationTag, outputOffset);
    outputOffset += authenticationTag.byteLength;
    await destination.sync();
    await destination.close();
    destination = undefined;
    await fileSystem.chmod(input.destinationPath, 0o400);

    return {
      byteLength: BigInt(outputOffset),
      header,
    };
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
      throw new Error('BACKUP_WRITE_FAILED');
    }
    written += result.bytesWritten;
  }
}
