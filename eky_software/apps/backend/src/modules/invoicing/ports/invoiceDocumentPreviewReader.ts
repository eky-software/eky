import type { InvoiceScope } from '../domain/invoiceContentRevision.js';

export interface InvoiceDocumentPreviewReader {
  // Selects a display target only. It never authorizes delivery or generation.
  findPreviewDocumentId(scope: InvoiceScope): Promise<string | undefined>;
}
