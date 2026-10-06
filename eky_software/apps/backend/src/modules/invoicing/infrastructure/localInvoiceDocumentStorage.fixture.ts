import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, onTestFinished } from 'vitest';

import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceDocumentFileEvidence } from '../ports/invoiceDocumentStorage.js';
import { LocalInvoiceDocumentStorage } from './localInvoiceDocumentStorage.js';

export const storageTestScope = { companyId: 'company-1', invoiceId: 'invoice-1' };

export function createPdfContent(label = 'original'): Buffer {
  return Buffer.from(`%PDF-1.7\n% Synthetic storage fixture: ${label}\n%%EOF\n`);
}

export function evidenceFor(storagePath: string, content: Uint8Array): InvoiceDocumentFileEvidence {
  return {
    storagePath,
    sha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: content.byteLength,
  };
}

export async function createStorageFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'eky-invoice-storage-'));
  onTestFinished(() => rm(temporaryRoot, { recursive: true, force: true }));
  const testRoot = await realpath(temporaryRoot);
  const storageRoot = join(testRoot, 'storage');
  const outsideRoot = join(testRoot, 'outside');
  await mkdir(storageRoot);
  await mkdir(outsideRoot);
  const sourcePath = join(outsideRoot, 'source.pdf');
  await writeFile(sourcePath, createPdfContent(), { flag: 'wx' });

  return {
    testRoot,
    storageRoot,
    outsideRoot,
    sourcePath,
    storage: new LocalInvoiceDocumentStorage(storageRoot),
    absolutePath: (storagePath: string) => join(storageRoot, ...storagePath.split('/')),
    async writeLegacy(storagePath = 'dev-company/invoice-1/approved-invoice.pdf', content = createPdfContent()) {
      const filePath = join(storageRoot, ...storagePath.split('/'));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, { flag: 'wx' });
      return evidenceFor(storagePath, content);
    },
  };
}

export async function expectIntegrityFailure(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
  await expect(operation).rejects.toMatchObject({
    name: 'InvoiceDocumentIntegrityError',
    message: 'Stored invoice document is inconsistent.',
  });
  await expect(operation).rejects.not.toHaveProperty('cause');
}

export async function snapshotStorageTree(root: string) {
  const entries: Array<Record<string, unknown>> = [];
  async function visit(relativePath: string): Promise<void> {
    const path = join(root, relativePath);
    const metadata = await lstat(path, { bigint: true });
    const type = metadata.isSymbolicLink() ? 'link' : metadata.isDirectory() ? 'directory' : 'file';
    entries.push({
      path: relativePath,
      type,
      dev: metadata.dev,
      ino: metadata.ino,
      nlink: metadata.nlink,
      mode: metadata.mode,
      size: metadata.size,
      mtimeNs: metadata.mtimeNs,
      ctimeNs: metadata.ctimeNs,
      ...(type === 'file' ? { sha256: evidenceFor('', await readFile(path)).sha256 } : {}),
      ...(type === 'link' ? { target: await readlink(path) } : {}),
    });
    if (type === 'directory') {
      for (const name of (await readdir(path)).sort()) {
        await visit(relativePath ? `${relativePath}/${name}` : name);
      }
    }
  }
  await visit('');
  return entries;
}
