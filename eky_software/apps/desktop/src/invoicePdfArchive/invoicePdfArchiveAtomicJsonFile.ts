import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname } from 'node:path';

import { InvoicePdfArchiveError } from './invoicePdfArchiveTypes.js';

const maximumJsonFileBytes = 2 * 1024 * 1024;

export class InvoicePdfArchiveAtomicJsonFile<Value> {
  private readonly backupFilePath: string;
  private readonly directoryPath: string;
  private readonly nextFilePath: string;

  constructor(
    private readonly filePath: string,
    private readonly parse: (value: unknown) => Value,
    private readonly invalidCode:
      | 'ARCHIVE_CONFIG_INVALID'
      | 'ARCHIVE_JOURNAL_INVALID',
  ) {
    this.backupFilePath = `${filePath}.backup`;
    this.directoryPath = dirname(filePath);
    this.nextFilePath = `${filePath}.next`;
  }

  async read(): Promise<Value | null> {
    const current = await this.readSlot(this.filePath);

    if (current !== null) {
      await this.removeRecoveryFiles();
      return current;
    }

    const backup = await this.readSlot(this.backupFilePath);

    if (backup !== null) {
      await this.restore(this.backupFilePath);
      await this.removeFile(this.nextFilePath);
      return backup;
    }

    const next = await this.readSlot(this.nextFilePath);

    if (next !== null) {
      await this.restore(this.nextFilePath);
      return next;
    }

    return null;
  }

  async remove(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.filePath, { force: true }),
      rm(this.nextFilePath, { force: true }),
      rm(this.backupFilePath, { force: true }),
    ]);

    if (results.some((result) => result.status === 'rejected')) {
      throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
    }
  }

  async write(value: Value): Promise<void> {
    const serialized = `${JSON.stringify(value)}\n`;

    if (Buffer.byteLength(serialized, 'utf8') > maximumJsonFileBytes) {
      throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
    }

    let currentMoved = false;

    try {
      await mkdir(this.directoryPath, { mode: 0o700, recursive: true });
      await this.removeFile(this.nextFilePath);
      await this.removeFile(this.backupFilePath);
      const handle = await open(this.nextFilePath, 'wx', 0o600);

      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      await chmod(this.nextFilePath, 0o600);

      try {
        await rename(this.filePath, this.backupFilePath);
        currentMoved = true;
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }
      }

      try {
        await rename(this.nextFilePath, this.filePath);
      } catch (error) {
        if (currentMoved) {
          await rename(this.backupFilePath, this.filePath).catch(
            () => undefined,
          );
        }
        throw error;
      }

      if (currentMoved) {
        await this.removeFile(this.backupFilePath);
      }
    } catch {
      throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
    } finally {
      await rm(this.nextFilePath, { force: true }).catch(() => undefined);
    }
  }

  private async readSlot(filePath: string): Promise<Value | null> {
    try {
      const stats = await lstat(filePath);

      if (
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        stats.size < 1 ||
        stats.size > maximumJsonFileBytes
      ) {
        throw new InvoicePdfArchiveError(this.invalidCode, false);
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(await readFile(filePath, 'utf8'));
      } catch {
        throw new InvoicePdfArchiveError(this.invalidCode, false);
      }

      return this.parse(parsed);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }
      if (error instanceof InvoicePdfArchiveError) {
        throw error;
      }
      throw new InvoicePdfArchiveError(this.invalidCode, false);
    }
  }

  private async removeRecoveryFiles(): Promise<void> {
    await this.removeFile(this.nextFilePath);
    await this.removeFile(this.backupFilePath);
  }

  private async removeFile(filePath: string): Promise<void> {
    try {
      await rm(filePath, { force: true });
    } catch {
      throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
    }
  }

  private async restore(sourcePath: string): Promise<void> {
    try {
      await rename(sourcePath, this.filePath);
    } catch {
      throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
