import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';

import { SecretBrokerError } from './secretBrokerErrors.js';

const encryptedSecretFileVersion = 1;
const expectedSecretFileName = 'company-email-smtp-v1.dat';
const maximumCiphertextBytes = 16_384;
const maximumEnvelopeBytes = 24_576;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface EncryptedSecretFileStore {
  read(): Promise<Uint8Array | null>;
  remove(): Promise<void>;
  write(ciphertext: Uint8Array): Promise<void>;
}

export class EncryptedSecretFile implements EncryptedSecretFileStore {
  private readonly directoryPath: string;

  constructor(private readonly filePath: string) {
    if (
      !isAbsolute(filePath) ||
      filePath.includes('\0') ||
      filePath.length > 4_096 ||
      basename(filePath) !== expectedSecretFileName
    ) {
      throw new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE');
    }

    this.directoryPath = dirname(filePath);
  }

  async read(): Promise<Uint8Array | null> {
    try {
      const fileStats = await lstat(this.filePath);

      if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
        throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
      }

      if (fileStats.size < 1 || fileStats.size > maximumEnvelopeBytes) {
        throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
      }

      return parseEnvelope(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }

      if (error instanceof SecretBrokerError) {
        throw error;
      }

      throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
    }
  }

  async remove(): Promise<void> {
    try {
      await rm(this.filePath, { force: true });
    } catch {
      throw new SecretBrokerError('SECRET_REMOVE_FAILED');
    }
  }

  async write(ciphertext: Uint8Array): Promise<void> {
    if (
      ciphertext.byteLength < 1 ||
      ciphertext.byteLength > maximumCiphertextBytes
    ) {
      throw new SecretBrokerError('SECRET_WRITE_FAILED');
    }

    const suffix = randomUUID();
    const temporaryPath = `${this.filePath}.${suffix}.tmp`;
    const backupPath = `${this.filePath}.${suffix}.bak`;
    let previousFileMoved = false;

    try {
      await mkdir(this.directoryPath, { mode: 0o700, recursive: true });
      const fileHandle = await open(temporaryPath, 'wx', 0o600);

      try {
        await fileHandle.writeFile(serializeEnvelope(ciphertext), 'utf8');
        await fileHandle.sync();
      } finally {
        await fileHandle.close();
      }

      await chmod(temporaryPath, 0o600);

      try {
        await rename(this.filePath, backupPath);
        previousFileMoved = true;
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }
      }

      try {
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        if (previousFileMoved) {
          await rename(backupPath, this.filePath).catch(() => undefined);
        }

        throw error;
      }

      if (previousFileMoved) {
        await rm(backupPath, { force: true });
      }
    } catch {
      throw new SecretBrokerError('SECRET_WRITE_FAILED');
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function serializeEnvelope(ciphertext: Uint8Array): string {
  return `${JSON.stringify({
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    formatVersion: encryptedSecretFileVersion,
  })}\n`;
}

function parseEnvelope(contents: string): Uint8Array {
  let value: unknown;

  try {
    value = JSON.parse(contents);
  } catch {
    throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
  }

  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['ciphertext', 'formatVersion']) ||
    value.formatVersion !== encryptedSecretFileVersion ||
    typeof value.ciphertext !== 'string' ||
    value.ciphertext.length === 0 ||
    !base64Pattern.test(value.ciphertext)
  ) {
    throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
  }

  const ciphertext = Buffer.from(value.ciphertext, 'base64');

  if (
    ciphertext.byteLength < 1 ||
    ciphertext.byteLength > maximumCiphertextBytes ||
    ciphertext.toString('base64') !== value.ciphertext
  ) {
    throw new SecretBrokerError('SECRET_PAYLOAD_INVALID');
  }

  return Uint8Array.from(ciphertext);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();

  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
