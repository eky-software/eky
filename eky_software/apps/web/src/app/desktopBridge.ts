export interface EkyDesktopApi {
  activatePreparedProfileRestore(): Promise<unknown>;
  chooseInvoicePdfArchiveDirectory(): Promise<unknown>;
  createEncryptedProfileBackup(): Promise<unknown>;
  createManualRecoveryPoint(): Promise<unknown>;
  createSupportBundle(): Promise<'cancelled' | 'created'>;
  disableInvoicePdfArchive(): Promise<unknown>;
  discardSelectedLocalUpdate(): Promise<unknown>;
  confirmLocalUpdate(): Promise<unknown>;
  cancelLocalUpdate(): Promise<unknown>;
  getLocalUpdateStatus(): Promise<unknown>;
  getInvoicePdfArchiveStatus(): Promise<unknown>;
  getProfileBackupStatus(): Promise<unknown>;
  inspectEncryptedProfileBackup(): Promise<unknown>;
  openInvoicePdf(invoiceId: string): Promise<void>;
  openInvoicePdfArchiveDirectory(): Promise<void>;
  openOperationalLogFolder(): Promise<void>;
  prepareEncryptedProfileRestore(): Promise<unknown>;
  retryPendingInvoicePdfArchiveTasks(): Promise<unknown>;
  selectLocalUpdate(): Promise<unknown>;
}

declare global {
  interface Window {
    ekyDesktop?: EkyDesktopApi;
  }
}

export { getDesktopProfileProtection } from './desktopProfileProtection.js';
export type {
  ProfileBackupInspectionResult,
  ProfileBackupInspectionSummary,
  ProfileProtectionCapability,
  ProfileProtectionStatus,
} from './desktopProfileProtection.js';

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

const localUpdatePhases = Object.freeze([
  'idle',
  'prepared',
  'recoveryPointValidated',
  'runtimeStopping',
  'awaitingFirstStart',
  'firstStartValidating',
  'installerNotApplied',
  'accepted',
  'rollbackRequired',
  'businessRollbackStarting',
  'businessRollbackCompleted',
  'rollbackPackageRequired',
  'binaryRollbackPrepared',
  'awaitingRollbackFirstStart',
  'rolledBack',
  'failed',
  'failedSafe',
  'recoveryRequired',
] as const);

export type LocalUpdatePhase = (typeof localUpdatePhases)[number];

export interface LocalUpdatePackageStatus {
  appVersion: string;
  buildRevision: string;
  msiProductVersion: string;
  packageFingerprint: string;
  releaseChannel: 'pilot';
  role: 'candidate';
  signingStatus: 'unsigned-prototype';
}

export interface LocalUpdateStatus {
  architecture: 'x64';
  candidate: LocalUpdatePackageStatus | null;
  current: {
    appVersion: string;
    buildRevision: string;
    msiProductVersion: string;
    releaseChannel: 'pilot';
  };
  currentRollbackPackage: 'missing' | 'ready';
  phase: LocalUpdatePhase;
  recoveryPointState:
    | 'notStarted'
    | 'pending'
    | 'ready'
    | 'recoveryRequired';
  signingStatus: 'unsigned-prototype';
}

export interface LocalUpdateCapability {
  cancel(): Promise<'cancelled'>;
  confirm(): Promise<'cancelled' | 'handoffStarted'>;
  discardSelected(): Promise<LocalUpdateStatus>;
  getStatus(): Promise<LocalUpdateStatus>;
  select(): Promise<'cancelled' | 'candidateReady' | 'currentRegistered'>;
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

export function getDesktopLocalUpdate(
  target: Pick<Window, 'ekyDesktop'> = window,
): LocalUpdateCapability | undefined {
  const desktop = target.ekyDesktop;
  if (
    typeof desktop?.getLocalUpdateStatus !== 'function' ||
    typeof desktop.selectLocalUpdate !== 'function' ||
    typeof desktop.discardSelectedLocalUpdate !== 'function' ||
    typeof desktop.confirmLocalUpdate !== 'function' ||
    typeof desktop.cancelLocalUpdate !== 'function'
  ) {
    return undefined;
  }

  return {
    async cancel() {
      const result = await desktop.cancelLocalUpdate();
      if (!isRecord(result) || !hasExactKeys(result, ['status']) ||
        result.status !== 'cancelled') {
        throw new Error('Invalid local update cancellation result.');
      }
      return 'cancelled';
    },
    async confirm() {
      const result = await desktop.confirmLocalUpdate();
      if (!isRecord(result) || !hasExactKeys(result, ['status']) ||
        (result.status !== 'cancelled' && result.status !== 'handoffStarted')) {
        throw new Error('Invalid local update confirmation result.');
      }
      return result.status;
    },
    async discardSelected() {
      const result = await desktop.discardSelectedLocalUpdate();
      if (!isRecord(result) || !hasExactKeys(result, ['status'])) {
        throw new Error('Invalid local update discard result.');
      }
      return readLocalUpdateStatus(result.status);
    },
    async getStatus() {
      return readLocalUpdateStatus(await desktop.getLocalUpdateStatus());
    },
    async select() {
      const result = await desktop.selectLocalUpdate();
      if (!isRecord(result) ||
        (result.status !== 'cancelled' &&
          result.status !== 'candidateReady' &&
          result.status !== 'currentRegistered')) {
        throw new Error('Invalid local update selection result.');
      }
      if (result.status === 'cancelled') {
        if (!hasExactKeys(result, ['status'])) {
          throw new Error('Invalid local update selection result.');
        }
        return result.status;
      }
      if (!hasExactKeys(result, ['package', 'status']) ||
        !isSafeSelectedPackage(result.package)) {
        throw new Error('Invalid local update selection result.');
      }
      return result.status;
    },
  };
}

function readLocalUpdateStatus(value: unknown): LocalUpdateStatus {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'architecture',
      'candidate',
      'current',
      'currentRollbackPackage',
      'phase',
      'recoveryPointState',
      'signingStatus',
    ]) ||
    value.architecture !== 'x64' ||
    !isCurrentUpdateIdentity(value.current) ||
    (value.candidate !== null && !isCandidateUpdateIdentity(value.candidate)) ||
    (value.currentRollbackPackage !== 'missing' &&
      value.currentRollbackPackage !== 'ready') ||
    !localUpdatePhases.includes(value.phase as LocalUpdatePhase) ||
    !['notStarted', 'pending', 'ready', 'recoveryRequired'].includes(
      value.recoveryPointState as string,
    ) ||
    value.signingStatus !== 'unsigned-prototype'
  ) {
    throw new Error('Invalid local update status.');
  }
  return value as unknown as LocalUpdateStatus;
}

function isCurrentUpdateIdentity(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, [
      'appVersion',
      'buildRevision',
      'msiProductVersion',
      'releaseChannel',
    ]) &&
    isSafeVersionText(value.appVersion) &&
    isSafeBuildRevision(value.buildRevision) &&
    isSafeVersionText(value.msiProductVersion) &&
    value.releaseChannel === 'pilot';
}

function isCandidateUpdateIdentity(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, [
      'appVersion',
      'buildRevision',
      'msiProductVersion',
      'packageFingerprint',
      'releaseChannel',
      'role',
      'signingStatus',
    ]) &&
    isSafeVersionText(value.appVersion) &&
    isSafeBuildRevision(value.buildRevision) &&
    isSafeVersionText(value.msiProductVersion) &&
    typeof value.packageFingerprint === 'string' &&
    /^[0-9a-f]{12}$/.test(value.packageFingerprint) &&
    value.releaseChannel === 'pilot' &&
    value.role === 'candidate' &&
    value.signingStatus === 'unsigned-prototype';
}

function isSafeSelectedPackage(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, [
      'appVersion',
      'buildRevision',
      'msiProductVersion',
      'releaseChannel',
      'role',
      'signingStatus',
    ]) &&
    isSafeVersionText(value.appVersion) &&
    isSafeBuildRevision(value.buildRevision) &&
    isSafeVersionText(value.msiProductVersion) &&
    value.releaseChannel === 'pilot' &&
    (value.role === 'candidate' || value.role === 'current') &&
    value.signingStatus === 'unsigned-prototype';
}

function isSafeVersionText(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 &&
    /^[0-9A-Za-z.+-]+$/.test(value);
}

function isSafeBuildRevision(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/.test(value);
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
  return value === null || isTimestamp(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
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
