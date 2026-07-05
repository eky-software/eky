import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';

const defaultStorageRoot = 'storage/invoices';

export class LocalInvoiceDocumentStorage implements InvoiceDocumentStorage {
  private readonly rootPath: string;

  constructor(rootPath = resolve(process.cwd(), defaultStorageRoot)) {
    this.rootPath = rootPath;
  }

  async deleteFile(storagePath: string): Promise<void> {
    const filePath = this.resolveStoragePath(storagePath);

    await rm(filePath, { force: true });
  }

  async readFile(storagePath: string): Promise<Uint8Array> {
    const filePath = this.resolveStoragePath(storagePath);

    return readFile(filePath);
  }

  async writeFile(storagePath: string, content: Uint8Array): Promise<void> {
    const filePath = this.resolveStoragePath(storagePath);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  private resolveStoragePath(storagePath: string): string {
    const filePath = resolve(this.rootPath, storagePath);
    const rootPrefix = this.rootPath.endsWith(sep)
      ? this.rootPath
      : `${this.rootPath}${sep}`;

    if (filePath !== this.rootPath && !filePath.startsWith(rootPrefix)) {
      throw new Error('Invoice document storage path is outside storage root.');
    }

    return filePath;
  }
}
