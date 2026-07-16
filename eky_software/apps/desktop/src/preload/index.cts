import { contextBridge, ipcRenderer } from 'electron';

const invoicePdfPreviewIpcChannel = 'eky:invoice-pdf-preview:open';

interface InvoicePdfPreviewApi {
  openInvoicePdf(invoiceId: string): Promise<void>;
}

const invoicePdfPreviewApi: InvoicePdfPreviewApi = Object.freeze({
  openInvoicePdf(invoiceId: string) {
    return ipcRenderer.invoke(invoicePdfPreviewIpcChannel, invoiceId);
  },
});

contextBridge.exposeInMainWorld('ekyDesktop', invoicePdfPreviewApi);
