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

interface EkyDesktopApi {
  chooseInvoicePdfArchiveDirectory(): Promise<unknown>;
  createSupportBundle(): Promise<'cancelled' | 'created'>;
  disableInvoicePdfArchive(): Promise<unknown>;
  getInvoicePdfArchiveStatus(): Promise<unknown>;
  openInvoicePdf(invoiceId: string): Promise<void>;
  openInvoicePdfArchiveDirectory(): Promise<void>;
  openOperationalLogFolder(): Promise<void>;
  retryPendingInvoicePdfArchiveTasks(): Promise<unknown>;
}

const ekyDesktopApi: EkyDesktopApi = Object.freeze({
  chooseInvoicePdfArchiveDirectory() {
    return ipcRenderer.invoke(chooseInvoicePdfArchiveDirectoryIpcChannel);
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
  openInvoicePdf(invoiceId: string) {
    return ipcRenderer.invoke(invoicePdfPreviewIpcChannel, invoiceId);
  },
  openInvoicePdfArchiveDirectory() {
    return ipcRenderer.invoke(openInvoicePdfArchiveDirectoryIpcChannel);
  },
  openOperationalLogFolder() {
    return ipcRenderer.invoke(openOperationalLogFolderIpcChannel);
  },
  retryPendingInvoicePdfArchiveTasks() {
    return ipcRenderer.invoke(retryPendingInvoicePdfArchiveTasksIpcChannel);
  },
});

contextBridge.exposeInMainWorld('ekyDesktop', ekyDesktopApi);
