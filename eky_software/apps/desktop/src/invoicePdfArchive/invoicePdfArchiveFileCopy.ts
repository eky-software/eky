import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { requireExistingDirectory } from './invoicePdfArchiveConfig.js';
import { finalizeInvoicePdfArchiveFile } from './invoicePdfArchiveFileFinalization.js';
import {
  InvoicePdfArchiveError,
  maximumArchivedInvoicePdfBytes,
  type InvoicePdfArchiveTask,
} from './invoicePdfArchiveTypes.js';

export interface LoadedInvoicePdfArchiveDocument {
  content: Uint8Array;
  documentId: string;
  invoiceId: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}

export type LoadInvoicePdfArchiveDocument = (
  task: InvoicePdfArchiveTask,
) => Promise<LoadedInvoicePdfArchiveDocument>;

export async function copyInvoicePdfToArchive(input: {
  directoryPath: string;
  loadDocument: LoadInvoicePdfArchiveDocument;
  task: InvoicePdfArchiveTask;
}): Promise<'alreadyArchived' | 'archived'> {
  const directoryPath = await requireExistingDirectory(input.directoryPath);
  const fileName = createInvoicePdfArchiveFileName(input.task);
  const finalPath = join(directoryPath, fileName);
  const document = await input.loadDocument(input.task);

  try {
    validateLoadedDocument(input.task, document);

    const existing = await readExistingPdf(finalPath);

    if (existing !== null) {
      if (
        existing.byteLength === input.task.expectedPdfSize &&
        calculateSha256(existing) === input.task.expectedPdfSha256
      ) {
        return 'alreadyArchived';
      }

      throw new InvoicePdfArchiveError('ARCHIVE_FILE_CONFLICT', false);
    }

    await writePdfAtomically(directoryPath, finalPath, document.content);
    return 'archived';
  } finally {
    document.content.fill(0);
  }
}

export function createInvoicePdfArchiveFileName(
  task: Pick<InvoicePdfArchiveTask, 'invoiceKind' | 'invoiceNumber'>,
): string {
  if (!/^\d{1,50}$/.test(task.invoiceNumber)) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }

  return `${task.invoiceKind === 'credit' ? 'Hyvityslasku' : 'Lasku'}-${task.invoiceNumber}.pdf`;
}

function validateLoadedDocument(
  task: InvoicePdfArchiveTask,
  document: LoadedInvoicePdfArchiveDocument,
): void {
  if (
    document.documentId !== task.documentId ||
    document.invoiceId !== task.invoiceId ||
    document.mimeType.toLowerCase() !== 'application/pdf' ||
    document.sizeBytes !== task.expectedPdfSize ||
    document.sha256 !== task.expectedPdfSha256 ||
    document.content.byteLength !== task.expectedPdfSize ||
    document.content.byteLength < 5 ||
    document.content.byteLength > maximumArchivedInvoicePdfBytes ||
    Buffer.from(document.content.subarray(0, 5)).toString('ascii') !== '%PDF-' ||
    calculateSha256(document.content) !== task.expectedPdfSha256
  ) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }
}

async function readExistingPdf(filePath: string): Promise<Uint8Array | null> {
  try {
    const fileStats = await stat(filePath);

    if (
      !fileStats.isFile() ||
      fileStats.size < 1 ||
      fileStats.size > maximumArchivedInvoicePdfBytes
    ) {
      throw new InvoicePdfArchiveError('ARCHIVE_FILE_CONFLICT', false);
    }

    return Uint8Array.from(await readFile(filePath));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    if (error instanceof InvoicePdfArchiveError) {
      throw error;
    }
    throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
  }
}

async function writePdfAtomically(
  directoryPath: string,
  finalPath: string,
  content: Uint8Array,
): Promise<void> {
  const temporaryPath = join(
    directoryPath,
    `.eky-invoice-pdf-${randomUUID()}.next`,
  );

  try {
    try {
      await finalizeInvoicePdfArchiveFile({
        content,
        finalPath,
        temporaryPath,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        const existing = await readExistingPdf(finalPath);

        if (
          existing !== null &&
          existing.byteLength === content.byteLength &&
          calculateSha256(existing) === calculateSha256(content)
        ) {
          return;
        }

        throw new InvoicePdfArchiveError('ARCHIVE_FILE_CONFLICT', false);
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof InvoicePdfArchiveError) {
      throw error;
    }
    throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
  }
}

function calculateSha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
