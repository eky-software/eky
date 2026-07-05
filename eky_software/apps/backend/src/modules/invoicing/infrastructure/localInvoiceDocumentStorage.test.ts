import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { LocalInvoiceDocumentStorage } from './localInvoiceDocumentStorage.js';

describe('LocalInvoiceDocumentStorage', () => {
  it('writes and reads invoice document files under the configured storage root', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'eky-invoice-storage-'));

    try {
      const storage = new LocalInvoiceDocumentStorage(storageRoot);
      const content = new Uint8Array([37, 80, 68, 70]);

      await storage.writeFile('dev-company/invoice-1/approved-invoice.pdf', content);

      await expect(
        readFile(join(storageRoot, 'dev-company/invoice-1/approved-invoice.pdf')),
      ).resolves.toEqual(Buffer.from(content));
      await expect(
        storage.readFile('dev-company/invoice-1/approved-invoice.pdf'),
      ).resolves.toEqual(Buffer.from(content));
    } finally {
      await rm(storageRoot, { force: true, recursive: true });
    }
  });

  it('rejects storage paths that escape the configured storage root', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'eky-invoice-storage-'));

    try {
      const storage = new LocalInvoiceDocumentStorage(storageRoot);

      await expect(
        storage.writeFile('../outside.pdf', new Uint8Array([37, 80, 68, 70])),
      ).rejects.toThrow('Invoice document storage path is outside storage root.');
    } finally {
      await rm(storageRoot, { force: true, recursive: true });
    }
  });
});
