import { link, open, rm, type FileHandle } from 'node:fs/promises';

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

  try {
    const handle = await operations.open(input.temporaryPath, 'wx', 0o600);

    try {
      await handle.writeFile(input.content);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await operations.link(input.temporaryPath, input.finalPath);
  } finally {
    await operations
      .rm(input.temporaryPath, { force: true })
      .catch(() => undefined);
  }
}
