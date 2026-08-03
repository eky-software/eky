import { createBackendRequestHeaders } from '../main/protocolPolicy.js';
import {
  InvoicePdfArchiveError,
  maximumArchivedInvoicePdfBytes,
  type InvoicePdfArchiveTask,
} from './invoicePdfArchiveTypes.js';
import type { LoadedInvoicePdfArchiveDocument } from './invoicePdfArchiveFileCopy.js';

const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumMetadataBytes = 64 * 1024;

export function createInvoicePdfArchiveBackendLoader(input: {
  backendOrigin: string;
  fetchImplementation(
    url: string,
    init?: RequestInit,
  ): Promise<Response>;
  runtimeSessionSecret: string;
}): (task: InvoicePdfArchiveTask) => Promise<LoadedInvoicePdfArchiveDocument> {
  return async (task) => {
    try {
      const metadataResponse = await input.fetchImplementation(
        `${input.backendOrigin}/invoices/${encodeURIComponent(task.invoiceId)}/pdf/metadata`,
        {
          headers: createBackendRequestHeaders(
            new Headers(),
            input.runtimeSessionSecret,
          ),
          method: 'GET',
        },
      );
      const metadata = await readMetadataResponse(metadataResponse);

      if (
        metadata.id !== task.documentId ||
        metadata.invoiceId !== task.invoiceId ||
        metadata.mimeType !== 'application/pdf' ||
        metadata.sha256 !== task.expectedPdfSha256 ||
        metadata.sizeBytes !== task.expectedPdfSize
      ) {
        throw new InvoicePdfArchiveError(
          'ARCHIVE_DOCUMENT_INVALID',
          false,
        );
      }

      const pdfResponse = await input.fetchImplementation(
        `${input.backendOrigin}/invoices/${encodeURIComponent(task.invoiceId)}/pdf`,
        {
          headers: createBackendRequestHeaders(
            new Headers(),
            input.runtimeSessionSecret,
          ),
          method: 'GET',
        },
      );
      const contentType = readMediaType(
        pdfResponse.headers.get('content-type'),
      );
      const declaredLength = readContentLength(
        pdfResponse.headers.get('content-length'),
      );

      if (
        !pdfResponse.ok ||
        contentType !== 'application/pdf' ||
        declaredLength !== task.expectedPdfSize
      ) {
        await pdfResponse.body?.cancel().catch(() => undefined);
        throw new InvoicePdfArchiveError(
          'ARCHIVE_DOCUMENT_INVALID',
          false,
        );
      }

      const content = new Uint8Array(await pdfResponse.arrayBuffer());

      if (content.byteLength > maximumArchivedInvoicePdfBytes) {
        content.fill(0);
        throw new InvoicePdfArchiveError(
          'ARCHIVE_DOCUMENT_INVALID',
          false,
        );
      }

      return {
        content,
        documentId: metadata.id,
        invoiceId: metadata.invoiceId,
        mimeType: metadata.mimeType,
        sha256: metadata.sha256,
        sizeBytes: metadata.sizeBytes,
      };
    } catch (error) {
      if (error instanceof InvoicePdfArchiveError) {
        throw error;
      }
      throw new InvoicePdfArchiveError('ARCHIVE_REQUEST_FAILED', true);
    }
  };
}

interface ArchiveDocumentMetadata {
  id: string;
  invoiceId: string;
  mimeType: 'application/pdf';
  sha256: string;
  sizeBytes: number;
}

async function readMetadataResponse(
  response: Response,
): Promise<ArchiveDocumentMetadata> {
  const declaredLength = readOptionalContentLength(
    response.headers.get('content-length'),
  );

  if (
    !response.ok ||
    (declaredLength !== null && declaredLength > maximumMetadataBytes)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new InvoicePdfArchiveError('ARCHIVE_REQUEST_FAILED', true);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.byteLength > maximumMetadataBytes) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }

  let value: unknown;

  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }

  if (!isRecord(value) || !isRecord(value.document)) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }

  const document = value.document;

  if (
    typeof document.id !== 'string' ||
    typeof document.invoiceId !== 'string' ||
    document.mimeType !== 'application/pdf' ||
    typeof document.sha256 !== 'string' ||
    !sha256Pattern.test(document.sha256) ||
    typeof document.sizeBytes !== 'number' ||
    !Number.isSafeInteger(document.sizeBytes) ||
    document.sizeBytes < 1 ||
    document.sizeBytes > maximumArchivedInvoicePdfBytes
  ) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }

  return {
    id: document.id,
    invoiceId: document.invoiceId,
    mimeType: document.mimeType,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
  };
}

function readContentLength(value: string | null): number {
  const parsed = readOptionalContentLength(value);

  if (parsed === null) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }
  return parsed;
}

function readOptionalContentLength(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }
  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > maximumArchivedInvoicePdfBytes
  ) {
    throw new InvoicePdfArchiveError('ARCHIVE_DOCUMENT_INVALID', false);
  }
  return parsed;
}

function readMediaType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
