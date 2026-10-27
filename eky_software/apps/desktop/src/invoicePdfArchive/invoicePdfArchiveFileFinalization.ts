import { link, open, rm, type FileHandle } from 'node:fs/promises';
import { InvoicePdfArchiveError } from './invoicePdfArchiveTypes.js';

export interface InvoicePdfArchiveFileOperations {
  link(existingPath: string, newPath: string): Promise<void>;
  open(path: string, flags: string, mode: number): Promise<FileHandle>;
  rm(path: string, options: { force: boolean }): Promise<void>;
}

const defaultFileOperations: InvoicePdfArchiveFileOperations = {
  link,
  open,
  rm,
};

export async function finalizeInvoicePdfArchiveFile(
  input: {
    content: Uint8Array;
    finalPath: string;
    temporaryPath: string;
  },
  operationOverrides: Partial<InvoicePdfArchiveFileOperations> = {},
): Promise<void> {
  const operations = {
    ...defaultFileOperations,
    ...operationOverrides,
  };

  let closeUncertain = false;
  let primaryFailure: unknown;
  try {
    const handle = await operations.open(input.temporaryPath, 'wx', 0o600);

    try {
      await handle.writeFile(input.content);
      await handle.sync();
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      try {
        await handle.close();
      } catch (error) {
        closeUncertain = true;
        throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true, true,
          primaryFailure ?? error);
      }
    }

    await operations.link(input.temporaryPath, input.finalPath);
  } finally {
    if (!closeUncertain) await operations
      .rm(input.temporaryPath, { force: true })
      .catch(() => undefined);
  }
}
