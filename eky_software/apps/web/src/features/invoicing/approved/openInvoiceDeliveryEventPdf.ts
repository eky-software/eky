export type DeliveryEventPdfTarget = Readonly<{
  kind: 'deliveryEvent';
  eventId: string;
}>;

export type OpenInvoiceDeliveryEventPdf = (
  invoiceId: string,
  eventId: string,
) => Promise<boolean>;

interface PreviewWindow {
  close(): void;
  location: { href: string };
  opener: unknown;
}

interface OpenInvoiceDeliveryEventPdfInput {
  invoiceId: string;
  eventId: string;
  getPdfUrl(invoiceId: string, eventId: string): string;
  openBrowserWindow(url: string, target: string): PreviewWindow | null;
  openDesktopPreview?(invoiceId: string, target: DeliveryEventPdfTarget): Promise<void>;
}

// History opening cannot create a PDF or fall back to the invoice's current PDF.
export async function openInvoiceDeliveryEventPdf(
  input: OpenInvoiceDeliveryEventPdfInput,
): Promise<boolean> {
  let preview: PreviewWindow | null = null;
  try {
    if (input.openDesktopPreview !== undefined) {
      await input.openDesktopPreview(input.invoiceId, {
        kind: 'deliveryEvent', eventId: input.eventId,
      });
      return true;
    }
    const url = input.getPdfUrl(input.invoiceId, input.eventId);
    preview = input.openBrowserWindow('', '_blank');
    if (preview === null) return false;
    preview.opener = null;
    preview.location.href = url;
    return true;
  } catch {
    try { preview?.close(); } catch { /* Keep the original opening failure. */ }
    return false;
  }
}
