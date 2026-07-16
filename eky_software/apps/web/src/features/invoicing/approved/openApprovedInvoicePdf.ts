import type { ApprovedInvoiceDocumentMetadata } from '@eky/api-client';

interface BrowserPdfPreviewWindow {
  close(): void;
  location: { href: string };
  opener: unknown;
}

export interface OpenApprovedInvoicePdfInput {
  createPdf(id: string): Promise<ApprovedInvoiceDocumentMetadata | null>;
  getPdfUrl(id: string): string;
  id: string;
  openBrowserWindow(
    url?: string | URL,
    target?: string,
    features?: string,
  ): BrowserPdfPreviewWindow | null;
  openDesktopPreview?(id: string): Promise<void>;
}

export async function openApprovedInvoicePdf(
  input: OpenApprovedInvoicePdfInput,
): Promise<boolean> {
  if (input.openDesktopPreview !== undefined) {
    const metadata = await input.createPdf(input.id);

    if (metadata === null) {
      return false;
    }

    try {
      await input.openDesktopPreview(input.id);
      return true;
    } catch {
      return false;
    }
  }

  const pdfWindow = input.openBrowserWindow('', '_blank');

  if (pdfWindow !== null) {
    pdfWindow.opener = null;
  }

  const metadata = await input.createPdf(input.id);

  if (metadata === null) {
    pdfWindow?.close();
    return false;
  }

  const pdfUrl = input.getPdfUrl(input.id);

  if (pdfWindow !== null) {
    pdfWindow.location.href = pdfUrl;
    return true;
  }

  return (
    input.openBrowserWindow(
      pdfUrl,
      '_blank',
      'noopener,noreferrer',
    ) !== null
  );
}
