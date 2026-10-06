export const invoicePdfPreviewIpcChannel = 'eky:invoice-pdf-preview:open';

export type InvoicePdfPreviewTarget =
  | { kind: 'preservedLegacy'; documentId: string }
  | { kind: 'deliveryEvent'; eventId: string };

export interface InvoicePdfPreviewApi {
  openInvoicePdf(
    invoiceId: string,
    target?: InvoicePdfPreviewTarget,
  ): Promise<void>;
}
