import { contextBridge, ipcRenderer } from 'electron';

const invoicePdfPreviewIpcChannel = 'eky:invoice-pdf-preview:open';
const openOperationalLogFolderIpcChannel =
  'eky:diagnostics:open-operational-log-folder';
const createSupportBundleIpcChannel =
  'eky:diagnostics:create-support-bundle';
const getInvoicePdfArchiveStatusIpcChannel =
  'eky:invoice-pdf-archive:get-status';
const chooseInvoicePdfArchiveDirectoryIpcChannel =
  'eky:invoice-pdf-archive:choose-directory';
const openInvoicePdfArchiveDirectoryIpcChannel =
  'eky:invoice-pdf-archive:open-directory';
const disableInvoicePdfArchiveIpcChannel =
  'eky:invoice-pdf-archive:disable';
const retryPendingInvoicePdfArchiveTasksIpcChannel =
  'eky:invoice-pdf-archive:retry-pending';
const createProfileBackupIpcChannel =
  'eky:profile-backup:create-portable';
const inspectProfileBackupIpcChannel =
  'eky:profile-backup:inspect-portable';
const getProfileBackupStatusIpcChannel =
  'eky:profile-backup:get-status';
const prepareProfileRestoreIpcChannel =
  'eky:profile-backup:prepare-restore';
const activatePreparedProfileRestoreIpcChannel =
  'eky:profile-backup:activate-restore';
const createManualRecoveryPointIpcChannel =
  'eky:profile-backup:create-recovery-point';
const selectLocalUpdateIpcChannel = 'eky:update:select-local';
const getLocalUpdateStatusIpcChannel = 'eky:update:get-status';
const discardSelectedLocalUpdateIpcChannel =
  'eky:update:discard-selected';
const confirmLocalUpdateIpcChannel = 'eky:update:confirm-local';
const cancelLocalUpdateIpcChannel = 'eky:update:cancel-local';

interface EkyDesktopApi {
  activatePreparedProfileRestore(): Promise<unknown>;
  chooseInvoicePdfArchiveDirectory(): Promise<unknown>;
  createEncryptedProfileBackup(): Promise<unknown>;
  createManualRecoveryPoint(): Promise<unknown>;
  createSupportBundle(): Promise<'cancelled' | 'created'>;
  disableInvoicePdfArchive(): Promise<unknown>;
  getInvoicePdfArchiveStatus(): Promise<unknown>;
  getProfileBackupStatus(): Promise<unknown>;
  getLocalUpdateStatus(): Promise<unknown>;
  inspectEncryptedProfileBackup(): Promise<unknown>;
  openInvoicePdf(invoiceId: string): Promise<void>;
  openInvoicePdfArchiveDirectory(): Promise<void>;
  openOperationalLogFolder(): Promise<void>;
  prepareEncryptedProfileRestore(): Promise<unknown>;
  retryPendingInvoicePdfArchiveTasks(): Promise<unknown>;
  discardSelectedLocalUpdate(): Promise<unknown>;
  confirmLocalUpdate(): Promise<unknown>;
  cancelLocalUpdate(): Promise<unknown>;
  selectLocalUpdate(): Promise<unknown>;
}

const ekyDesktopApi: EkyDesktopApi = Object.freeze({
  activatePreparedProfileRestore() {
    return ipcRenderer.invoke(activatePreparedProfileRestoreIpcChannel);
  },
  chooseInvoicePdfArchiveDirectory() {
    return ipcRenderer.invoke(chooseInvoicePdfArchiveDirectoryIpcChannel);
  },
  createEncryptedProfileBackup() {
    return ipcRenderer.invoke(createProfileBackupIpcChannel);
  },
  createManualRecoveryPoint() {
    return ipcRenderer.invoke(createManualRecoveryPointIpcChannel);
  },
  createSupportBundle() {
    return ipcRenderer.invoke(createSupportBundleIpcChannel);
  },
  disableInvoicePdfArchive() {
    return ipcRenderer.invoke(disableInvoicePdfArchiveIpcChannel);
  },
  getInvoicePdfArchiveStatus() {
    return ipcRenderer.invoke(getInvoicePdfArchiveStatusIpcChannel);
  },
  getProfileBackupStatus() {
    return ipcRenderer.invoke(getProfileBackupStatusIpcChannel);
  },
  getLocalUpdateStatus() {
    return ipcRenderer.invoke(getLocalUpdateStatusIpcChannel);
  },
  inspectEncryptedProfileBackup() {
    return ipcRenderer.invoke(inspectProfileBackupIpcChannel);
  },
  openInvoicePdf(invoiceId: string) {
    return ipcRenderer.invoke(invoicePdfPreviewIpcChannel, invoiceId);
  },
  openInvoicePdfArchiveDirectory() {
    return ipcRenderer.invoke(openInvoicePdfArchiveDirectoryIpcChannel);
  },
  openOperationalLogFolder() {
    return ipcRenderer.invoke(openOperationalLogFolderIpcChannel);
  },
  prepareEncryptedProfileRestore() {
    return ipcRenderer.invoke(prepareProfileRestoreIpcChannel);
  },
  retryPendingInvoicePdfArchiveTasks() {
    return ipcRenderer.invoke(retryPendingInvoicePdfArchiveTasksIpcChannel);
  },
  discardSelectedLocalUpdate() {
    return ipcRenderer.invoke(discardSelectedLocalUpdateIpcChannel);
  },
  confirmLocalUpdate() {
    return ipcRenderer.invoke(confirmLocalUpdateIpcChannel);
  },
  cancelLocalUpdate() {
    return ipcRenderer.invoke(cancelLocalUpdateIpcChannel);
  },
  selectLocalUpdate() {
    return ipcRenderer.invoke(selectLocalUpdateIpcChannel);
  },
});

contextBridge.exposeInMainWorld('ekyDesktop', ekyDesktopApi);
