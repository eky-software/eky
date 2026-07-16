export interface DesktopInvoicePdfPreviewApi {
  openInvoicePdf(invoiceId: string): Promise<void>;
}

declare global {
  interface Window {
    ekyDesktop?: DesktopInvoicePdfPreviewApi;
  }
}

export type OpenInvoicePdfPreview = (invoiceId: string) => Promise<void>;

export function getDesktopInvoicePdfPreview(
  target: Pick<Window, 'ekyDesktop'> = window,
): OpenInvoicePdfPreview | undefined {
  const openInvoicePdf = target.ekyDesktop?.openInvoicePdf;

  if (typeof openInvoicePdf !== 'function') {
    return undefined;
  }

  return (invoiceId) => openInvoicePdf(invoiceId);
}
