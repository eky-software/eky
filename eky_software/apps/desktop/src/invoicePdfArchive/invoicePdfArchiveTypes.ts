export const invoicePdfArchiveSchemaVersion = 1;
export const maximumArchivedInvoicePdfBytes = 25 * 1024 * 1024;

export type InvoicePdfArchiveInvoiceKind = 'credit' | 'standard';

export const invoicePdfArchiveSafeErrorCodes = Object.freeze([
  'ARCHIVE_CONFIG_INVALID',
  'ARCHIVE_DIRECTORY_UNAVAILABLE',
  'ARCHIVE_DOCUMENT_INVALID',
  'ARCHIVE_FILE_CONFLICT',
  'ARCHIVE_JOURNAL_INVALID',
  'ARCHIVE_REQUEST_FAILED',
  'ARCHIVE_STORAGE_FAILED',
] as const);

export type InvoicePdfArchiveSafeErrorCode =
  (typeof invoicePdfArchiveSafeErrorCodes)[number];

export interface InvoicePdfArchiveConfig {
  directoryPath: string;
  enabled: true;
  schemaVersion: typeof invoicePdfArchiveSchemaVersion;
}

export interface InvoicePdfArchiveTask {
  attemptCount: number;
  createdAt: string;
  deliveryEventId: string;
  documentId: string;
  expectedPdfSha256: string;
  expectedPdfSize: number;
  invoiceId: string;
  invoiceKind: InvoicePdfArchiveInvoiceKind;
  invoiceNumber: string;
  lastSafeErrorCode: InvoicePdfArchiveSafeErrorCode | null;
  nextAttemptAt: string;
  schemaVersion: typeof invoicePdfArchiveSchemaVersion;
  taskId: string;
}

export interface InvoicePdfArchiveJournal {
  lastArchivedAt: string | null;
  lastSafeErrorCode: InvoicePdfArchiveSafeErrorCode | null;
  schemaVersion: typeof invoicePdfArchiveSchemaVersion;
  tasks: InvoicePdfArchiveTask[];
}

export interface InvoicePdfArchiveStatus {
  displayName: string | null;
  enabled: boolean;
  lastArchivedAt: string | null;
  lastSafeErrorCode: InvoicePdfArchiveSafeErrorCode | null;
  pendingCount: number;
}

export class InvoicePdfArchiveError extends Error {
  constructor(
    readonly code: InvoicePdfArchiveSafeErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'InvoicePdfArchiveError';
  }
}

export function isInvoicePdfArchiveSafeErrorCode(
  value: unknown,
): value is InvoicePdfArchiveSafeErrorCode {
  return (
    typeof value === 'string' &&
    invoicePdfArchiveSafeErrorCodes.includes(
      value as InvoicePdfArchiveSafeErrorCode,
    )
  );
}
