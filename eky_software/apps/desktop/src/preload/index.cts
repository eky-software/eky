import { contextBridge, ipcRenderer } from 'electron';

const invoicePdfPreviewIpcChannel = 'eky:invoice-pdf-preview:open';
const openOperationalLogFolderIpcChannel =
  'eky:diagnostics:open-operational-log-folder';

interface EkyDesktopApi {
  openInvoicePdf(invoiceId: string): Promise<void>;
  openOperationalLogFolder(): Promise<void>;
}

const ekyDesktopApi: EkyDesktopApi = Object.freeze({
  openInvoicePdf(invoiceId: string) {
    return ipcRenderer.invoke(invoicePdfPreviewIpcChannel, invoiceId);
  },
  openOperationalLogFolder() {
    return ipcRenderer.invoke(openOperationalLogFolderIpcChannel);
  },
});

contextBridge.exposeInMainWorld('ekyDesktop', ekyDesktopApi);
