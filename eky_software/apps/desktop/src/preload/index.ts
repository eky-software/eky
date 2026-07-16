import { contextBridge, ipcRenderer } from 'electron';

import {
  invoicePdfPreviewIpcChannel,
  type InvoicePdfPreviewApi,
} from '../pdf/invoicePdfPreviewTypes.js';

const invoicePdfPreviewApi: InvoicePdfPreviewApi = Object.freeze({
  openInvoicePdf(invoiceId: string) {
    return ipcRenderer.invoke(invoicePdfPreviewIpcChannel, invoiceId);
  },
});

contextBridge.exposeInMainWorld('ekyDesktop', invoicePdfPreviewApi);
