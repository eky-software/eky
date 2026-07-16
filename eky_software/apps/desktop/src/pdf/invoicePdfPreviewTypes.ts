export const invoicePdfPreviewIpcChannel = 'eky:invoice-pdf-preview:open';

export interface InvoicePdfPreviewApi {
  openInvoicePdf(invoiceId: string): Promise<void>;
}
