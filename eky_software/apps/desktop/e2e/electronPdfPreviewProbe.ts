import { createInvoicePdfPreviewUrl } from '../src/pdf/invoicePdfPreviewPolicy.js';

// Select only the production PDF destinations for E2E observation and closing.
export function isElectronPdfPreviewUrl(value: string): boolean {
  try {
    const parts = new URL(value).pathname.split('/');
    if (parts[1] !== 'invoices') return false;
    if (parts.length === 4 && parts[3] === 'pdf') {
      return value === createInvoicePdfPreviewUrl(parts[2]);
    }
    if (parts.length !== 6 || parts[5] !== 'pdf') return false;
    if (parts[3] === 'delivery-events') {
      return value === createInvoicePdfPreviewUrl(parts[2], {
        kind: 'deliveryEvent', eventId: parts[4],
      });
    }
    if (parts[3] === 'preserved-documents') {
      return value === createInvoicePdfPreviewUrl(parts[2], {
        kind: 'preservedLegacy', documentId: parts[4],
      });
    }
    return false;
  } catch {
    return false;
  }
}
