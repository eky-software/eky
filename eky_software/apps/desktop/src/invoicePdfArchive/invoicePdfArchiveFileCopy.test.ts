import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  copyInvoicePdfToArchive,
  createInvoicePdfArchiveFileName,
} from './invoicePdfArchiveFileCopy.js';
import {
  InvoicePdfArchiveError,
  type InvoicePdfArchiveTask,
} from './invoicePdfArchiveTypes.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('copyInvoicePdfToArchive', () => {
  it('writes the exact validated standard PDF with a controlled filename', async () => {
    const root = await createTemporaryRoot();
    const content = createPdf('%PDF-1.7\nsynthetic invoice');
    const expectedContent = Uint8Array.from(content);
    const task = createTask(content);
    const loadDocument = vi.fn().mockResolvedValue(createDocument(task, content));

    await expect(
      copyInvoicePdfToArchive({
        directoryPath: root,
        loadDocument,
        task,
      }),
    ).resolves.toBe('archived');
    await expect(
      readFile(join(root, 'Lasku-2026001.pdf')),
    ).resolves.toEqual(Buffer.from(expectedContent));
    expect(await readdir(root)).toEqual(['Lasku-2026001.pdf']);
  });

  it('uses the credit invoice prefix without user-controlled filename data', () => {
    expect(
      createInvoicePdfArchiveFileName({
        invoiceKind: 'credit',
        invoiceNumber: '2026002',
      }),
    ).toBe('Hyvityslasku-2026002.pdf');
    expect(() =>
      createInvoicePdfArchiveFileName({
        invoiceKind: 'standard',
        invoiceNumber: '../escape',
      }),
    ).toThrowError(InvoicePdfArchiveError);
  });

  it('treats an identical existing PDF as idempotent', async () => {
    const root = await createTemporaryRoot();
    const content = createPdf('%PDF-1.7\nsame');
    const task = createTask(content);
    await writeFile(join(root, 'Lasku-2026001.pdf'), content);

    await expect(
      copyInvoicePdfToArchive({
        directoryPath: root,
        loadDocument: vi.fn().mockResolvedValue(createDocument(task, content)),
        task,
      }),
    ).resolves.toBe('alreadyArchived');
  });

  it('does not overwrite a conflicting existing file', async () => {
    const root = await createTemporaryRoot();
    const existing = createPdf('%PDF-1.7\nexisting');
    const content = createPdf('%PDF-1.7\nnew');
    const task = createTask(content);
    const path = join(root, 'Lasku-2026001.pdf');
    await writeFile(path, existing);

    await expect(
      copyInvoicePdfToArchive({
        directoryPath: root,
        loadDocument: vi.fn().mockResolvedValue(createDocument(task, content)),
        task,
      }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_FILE_CONFLICT' });
    await expect(readFile(path)).resolves.toEqual(Buffer.from(existing));
  });

  it('never overwrites when different PDFs race for the same invoice filename', async () => {
    const root = await createTemporaryRoot();
    const firstContent = createPdf('%PDF-1.7\nfirst');
    const secondContent = createPdf('%PDF-1.7\nsecond');
    const expectedFirstContent = Uint8Array.from(firstContent);
    const expectedSecondContent = Uint8Array.from(secondContent);
    const firstTask = createTask(firstContent);
    const secondTask = createTask(secondContent);
    const results = await Promise.allSettled([
      copyInvoicePdfToArchive({
        directoryPath: root,
        loadDocument: vi
          .fn()
          .mockResolvedValue(createDocument(firstTask, firstContent)),
        task: firstTask,
      }),
      copyInvoicePdfToArchive({
        directoryPath: root,
        loadDocument: vi
          .fn()
          .mockResolvedValue(createDocument(secondTask, secondContent)),
        task: secondTask,
      }),
    ]);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: 'ARCHIVE_FILE_CONFLICT',
    });
    const archived = await readFile(join(root, 'Lasku-2026001.pdf'));

    expect(
      archived.equals(Buffer.from(expectedFirstContent)) ||
        archived.equals(Buffer.from(expectedSecondContent)),
    ).toBe(true);
    expect(await readdir(root)).toEqual(['Lasku-2026001.pdf']);
  });

  it.each([
    ['document id', { documentId: 'wrong-document' }],
    ['invoice id', { invoiceId: 'wrong-invoice' }],
    ['MIME type', { mimeType: 'text/plain' }],
    ['declared size', { sizeBytes: 1 }],
    ['declared hash', { sha256: 'b'.repeat(64) }],
  ])('rejects a mismatching %s binding', async (_label, override) => {
    const root = await createTemporaryRoot();
    const content = createPdf('%PDF-1.7\nsynthetic');
    const task = createTask(content);

    await expect(
      copyInvoicePdfToArchive({
        directoryPath: root,
        loadDocument: vi
          .fn()
          .mockResolvedValue({ ...createDocument(task, content), ...override }),
        task,
      }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_DOCUMENT_INVALID' });
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects content without a PDF signature and clears loaded bytes', async () => {
    const root = await createTemporaryRoot();
    const content = Uint8Array.from(Buffer.from('not-a-pdf'));
    const task = createTask(content);

    await expect(
      copyInvoicePdfToArchive({
        directoryPath: root,
        loadDocument: vi.fn().mockResolvedValue(createDocument(task, content)),
        task,
      }),
    ).rejects.toMatchObject({ code: 'ARCHIVE_DOCUMENT_INVALID' });
    expect(content.every((value) => value === 0)).toBe(true);
  });
});

function createTask(content: Uint8Array): InvoicePdfArchiveTask {
  return {
    attemptCount: 0,
    createdAt: '2026-08-03T20:00:00.000Z',
    deliveryEventId: 'delivery-event-1',
    documentId: 'document-1',
    expectedPdfSha256: hash(content),
    expectedPdfSize: content.byteLength,
    invoiceId: 'invoice-1',
    invoiceKind: 'standard',
    invoiceNumber: '2026001',
    lastSafeErrorCode: null,
    nextAttemptAt: '2026-08-03T20:00:00.000Z',
    schemaVersion: 1,
    taskId: 'task-1',
  };
}

function createDocument(task: InvoicePdfArchiveTask, content: Uint8Array) {
  return {
    content,
    documentId: task.documentId,
    invoiceId: task.invoiceId,
    mimeType: 'application/pdf',
    sha256: task.expectedPdfSha256,
    sizeBytes: task.expectedPdfSize,
  };
}

function createPdf(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value));
}

function hash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-archive-copy-'));
  temporaryRoots.push(root);
  return root;
}
