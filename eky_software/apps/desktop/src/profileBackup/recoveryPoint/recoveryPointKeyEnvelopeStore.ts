import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  resolve,
} from 'node:path';

const keyEnvelopeFormatVersion = 1;
const maximumEncryptedDataKeyBytes = 16_384;
const maximumEnvelopeBytes = 24_576;
const artifactIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class RecoveryPointKeyEnvelopeError extends Error {
  constructor(
    readonly code:
      | 'RECOVERY_POINT_KEY_ENVELOPE_INVALID'
      | 'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'RecoveryPointKeyEnvelopeError';
  }
}

export class RecoveryPointKeyEnvelopeStore {
  private readonly backupPath: string;
  private readonly nextPath: string;

  constructor(
    private readonly artifactId: string,
    private readonly filePath: string,
  ) {
    if (
      !artifactIdPattern.test(artifactId) ||
      !isAbsolute(filePath) ||
      filePath.includes('\0') ||
      basename(filePath) !== `${artifactId}.key.json`
    ) {
      throw new RecoveryPointKeyEnvelopeError(
        'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
      );
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  async read(): Promise<Uint8Array> {
    const current = await readEnvelope(this.filePath, this.artifactId);
    if (current !== null) {
      await this.removeRecoveryFiles();
      return current;
    }

    const backup = await readEnvelope(
      this.backupPath,
      this.artifactId,
    );
    if (backup !== null) {
      await rename(this.backupPath, this.filePath).catch(() => {
        throw new RecoveryPointKeyEnvelopeError(
          'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
        );
      });
      await rm(this.nextPath, { force: true }).catch(() => undefined);
      return backup;
    }

    const next = await readEnvelope(this.nextPath, this.artifactId);
    if (next !== null) {
      await rename(this.nextPath, this.filePath).catch(() => {
        throw new RecoveryPointKeyEnvelopeError(
          'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
        );
      });
      return next;
    }

    throw new RecoveryPointKeyEnvelopeError(
      'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
    );
  }

  async remove(): Promise<void> {
    const removals = await Promise.allSettled([
      rm(this.filePath, { force: true }),
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (removals.some((removal) => removal.status === 'rejected')) {
      throw new RecoveryPointKeyEnvelopeError(
        'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
      );
    }
  }

  async write(encryptedDataKey: Uint8Array): Promise<void> {
    if (
      encryptedDataKey.byteLength < 1 ||
      encryptedDataKey.byteLength > maximumEncryptedDataKeyBytes
    ) {
      throw new RecoveryPointKeyEnvelopeError(
        'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
      );
    }
    const directoryPath = dirname(this.filePath);
    let previousMoved = false;

    try {
      await mkdir(directoryPath, { mode: 0o700, recursive: true });
      await assertPrivateDirectory(directoryPath);
      await rm(this.nextPath, { force: true });
      await rm(this.backupPath, { force: true });
      const file = await open(this.nextPath, 'wx', 0o600);
      try {
        await file.writeFile(
          serializeEnvelope(this.artifactId, encryptedDataKey),
          'utf8',
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await chmod(this.nextPath, 0o600);

      try {
        await rename(this.filePath, this.backupPath);
        previousMoved = true;
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
      try {
        await rename(this.nextPath, this.filePath);
      } catch (error) {
        if (previousMoved) {
          await rename(this.backupPath, this.filePath).catch(
            () => undefined,
          );
        }
        throw error;
      }
      if (previousMoved) {
        await rm(this.backupPath, { force: true });
      }
    } catch {
      throw new RecoveryPointKeyEnvelopeError(
        'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
      );
    } finally {
      await rm(this.nextPath, { force: true }).catch(() => undefined);
    }
  }

  private async removeRecoveryFiles(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new RecoveryPointKeyEnvelopeError(
        'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
      );
    }
  }
}

async function readEnvelope(
  path: string,
  artifactId: string,
): Promise<Uint8Array | null> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maximumEnvelopeBytes
    ) {
      throw new RecoveryPointKeyEnvelopeError(
        'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
      );
    }
    return parseEnvelope(await readFile(path, 'utf8'), artifactId);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    if (error instanceof RecoveryPointKeyEnvelopeError) {
      throw error;
    }
    throw new RecoveryPointKeyEnvelopeError(
      'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
    );
  }
}

function serializeEnvelope(
  artifactId: string,
  encryptedDataKey: Uint8Array,
): string {
  return `${JSON.stringify({
    artifactId,
    encryptedDataKey: Buffer.from(encryptedDataKey).toString('base64'),
    formatVersion: keyEnvelopeFormatVersion,
  })}\n`;
}

function parseEnvelope(
  contents: string,
  expectedArtifactId: string,
): Uint8Array {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new RecoveryPointKeyEnvelopeError(
      'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
    );
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'artifactId',
      'encryptedDataKey',
      'formatVersion',
    ]) ||
    value.artifactId !== expectedArtifactId ||
    value.formatVersion !== keyEnvelopeFormatVersion ||
    typeof value.encryptedDataKey !== 'string' ||
    value.encryptedDataKey.length === 0 ||
    !base64Pattern.test(value.encryptedDataKey)
  ) {
    throw new RecoveryPointKeyEnvelopeError(
      'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
    );
  }
  const encrypted = Buffer.from(value.encryptedDataKey, 'base64');
  if (
    encrypted.byteLength < 1 ||
    encrypted.byteLength > maximumEncryptedDataKeyBytes ||
    encrypted.toString('base64') !== value.encryptedDataKey
  ) {
    throw new RecoveryPointKeyEnvelopeError(
      'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
    );
  }
  return Uint8Array.from(encrypted);
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new RecoveryPointKeyEnvelopeError(
      'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
    );
  }
  const real = await realpath(path);
  if (!pathsAreEqual(real, path)) {
    throw new RecoveryPointKeyEnvelopeError(
      'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
    );
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    [...expected]
      .sort()
      .every((key, index) => actual[index] === key)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
