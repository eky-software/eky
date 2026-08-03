export interface EkyDesktopApi {
  chooseInvoicePdfArchiveDirectory(): Promise<unknown>;
  createSupportBundle(): Promise<'cancelled' | 'created'>;
  disableInvoicePdfArchive(): Promise<unknown>;
  getInvoicePdfArchiveStatus(): Promise<unknown>;
  openInvoicePdf(invoiceId: string): Promise<void>;
  openInvoicePdfArchiveDirectory(): Promise<void>;
  openOperationalLogFolder(): Promise<void>;
  retryPendingInvoicePdfArchiveTasks(): Promise<unknown>;
}

declare global {
  interface Window {
    ekyDesktop?: EkyDesktopApi;
  }
}

export type OpenInvoicePdfPreview = (invoiceId: string) => Promise<void>;

export const invoicePdfArchiveSafeErrorCodes = Object.freeze([
  'ARCHIVE_CONFIG_INVALID',
  'ARCHIVE_DIRECTORY_UNAVAILABLE',
  'ARCHIVE_DIRECTORY_UNSUPPORTED',
  'ARCHIVE_DOCUMENT_INVALID',
  'ARCHIVE_FILE_CONFLICT',
  'ARCHIVE_JOURNAL_INVALID',
  'ARCHIVE_REQUEST_FAILED',
  'ARCHIVE_STORAGE_FAILED',
] as const);

export type InvoicePdfArchiveSafeErrorCode =
  (typeof invoicePdfArchiveSafeErrorCodes)[number];

export interface InvoicePdfArchiveStatus {
  displayName: string | null;
  enabled: boolean;
  lastArchivedAt: string | null;
  lastSafeErrorCode: InvoicePdfArchiveSafeErrorCode | null;
  pendingCount: number;
}

export interface InvoicePdfArchiveCapability {
  chooseDirectory(): Promise<InvoicePdfArchiveStatus>;
  disable(): Promise<InvoicePdfArchiveStatus>;
  getStatus(): Promise<InvoicePdfArchiveStatus>;
  openDirectory(): Promise<void>;
  retryPending(): Promise<InvoicePdfArchiveStatus>;
}

export function getDesktopInvoicePdfPreview(
  target: Pick<Window, 'ekyDesktop'> = window,
): OpenInvoicePdfPreview | undefined {
  const openInvoicePdf = target.ekyDesktop?.openInvoicePdf;

  if (typeof openInvoicePdf !== 'function') {
    return undefined;
  }

  return (invoiceId) => openInvoicePdf(invoiceId);
}

export type OpenOperationalLogFolder = () => Promise<void>;

export function getDesktopOperationalLogFolder(
  target: Pick<Window, 'ekyDesktop'> = window,
): OpenOperationalLogFolder | undefined {
  const openOperationalLogFolder =
    target.ekyDesktop?.openOperationalLogFolder;

  if (typeof openOperationalLogFolder !== 'function') {
    return undefined;
  }

  return () => openOperationalLogFolder();
}

export type CreateSupportBundle = () => Promise<'cancelled' | 'created'>;

export function getDesktopSupportBundleCreator(
  target: Pick<Window, 'ekyDesktop'> = window,
): CreateSupportBundle | undefined {
  const createSupportBundle = target.ekyDesktop?.createSupportBundle;

  if (typeof createSupportBundle !== 'function') {
    return undefined;
  }

  return () => createSupportBundle();
}

export function getDesktopInvoicePdfArchive(
  target: Pick<Window, 'ekyDesktop'> = window,
): InvoicePdfArchiveCapability | undefined {
  const desktop = target.ekyDesktop;

  if (
    typeof desktop?.chooseInvoicePdfArchiveDirectory !== 'function' ||
    typeof desktop.disableInvoicePdfArchive !== 'function' ||
    typeof desktop.getInvoicePdfArchiveStatus !== 'function' ||
    typeof desktop.openInvoicePdfArchiveDirectory !== 'function' ||
    typeof desktop.retryPendingInvoicePdfArchiveTasks !== 'function'
  ) {
    return undefined;
  }

  return {
    async chooseDirectory() {
      return readInvoicePdfArchiveStatus(
        await desktop.chooseInvoicePdfArchiveDirectory(),
      );
    },
    async disable() {
      return readInvoicePdfArchiveStatus(
        await desktop.disableInvoicePdfArchive(),
      );
    },
    async getStatus() {
      return readInvoicePdfArchiveStatus(
        await desktop.getInvoicePdfArchiveStatus(),
      );
    },
    openDirectory() {
      return desktop.openInvoicePdfArchiveDirectory();
    },
    async retryPending() {
      return readInvoicePdfArchiveStatus(
        await desktop.retryPendingInvoicePdfArchiveTasks(),
      );
    },
  };
}

function readInvoicePdfArchiveStatus(
  value: unknown,
): InvoicePdfArchiveStatus {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'displayName',
      'enabled',
      'lastArchivedAt',
      'lastSafeErrorCode',
      'pendingCount',
    ]) ||
    typeof value.enabled !== 'boolean' ||
    !isSafeDisplayName(value.displayName) ||
    !isTimestampOrNull(value.lastArchivedAt) ||
    !isSafeErrorCodeOrNull(value.lastSafeErrorCode) ||
    typeof value.pendingCount !== 'number' ||
    !Number.isSafeInteger(value.pendingCount) ||
    value.pendingCount < 0
  ) {
    throw new Error('Invalid invoice PDF archive status.');
  }

  return {
    displayName: value.displayName,
    enabled: value.enabled,
    lastArchivedAt: value.lastArchivedAt,
    lastSafeErrorCode: value.lastSafeErrorCode,
    pendingCount: value.pendingCount,
  };
}

function isSafeDisplayName(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 255 &&
      !/[\\/]/.test(value))
  );
}

function isTimestampOrNull(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
      !Number.isNaN(Date.parse(value)))
  );
}

function isSafeErrorCodeOrNull(
  value: unknown,
): value is InvoicePdfArchiveSafeErrorCode | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      invoicePdfArchiveSafeErrorCodes.includes(
        value as InvoicePdfArchiveSafeErrorCode,
      ))
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
