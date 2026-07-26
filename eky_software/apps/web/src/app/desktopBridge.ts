export interface EkyDesktopApi {
  createSupportBundle(): Promise<'cancelled' | 'created'>;
  openInvoicePdf(invoiceId: string): Promise<void>;
  openOperationalLogFolder(): Promise<void>;
}

declare global {
  interface Window {
    ekyDesktop?: EkyDesktopApi;
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
