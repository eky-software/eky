import type { ApprovedInvoiceEmailPreview } from '@eky/api-client';

export type PreservedInvoicePdfTarget = Extract<
  ApprovedInvoiceEmailPreview['documentTarget'],
  { kind: 'preservedLegacy' }
>;

export type OpenPreservedInvoicePdf = (
  invoiceId: string,
  documentId: string,
) => Promise<boolean>;

interface PreviewWindow {
  close(): void;
  location: { href: string };
  opener: unknown;
}

interface OpenPreservedInvoicePdfInput {
  invoiceId: string;
  documentId: string;
  getPdfUrl(invoiceId: string, documentId: string): string;
  openBrowserWindow(url: string, target: string): PreviewWindow | null;
  openDesktopPreview?(invoiceId: string, target: PreservedInvoicePdfTarget): Promise<void>;
}

// This path can only read the selected copy; it has no PDF creation capability.
export async function openPreservedInvoicePdf(
  input: OpenPreservedInvoicePdfInput,
): Promise<boolean> {
  let preview: PreviewWindow | null = null;
  try {
    if (input.openDesktopPreview !== undefined) {
      await input.openDesktopPreview(input.invoiceId, {
        kind: 'preservedLegacy',
        documentId: input.documentId,
      });
      return true;
    }

    const url = input.getPdfUrl(input.invoiceId, input.documentId);
    preview = input.openBrowserWindow('', '_blank');
    if (preview === null) return false;
    preview.opener = null;
    preview.location.href = url;
    return true;
  } catch {
    try { preview?.close(); } catch { /* Preserve the original opening failure. */ }
    return false;
  }
}
