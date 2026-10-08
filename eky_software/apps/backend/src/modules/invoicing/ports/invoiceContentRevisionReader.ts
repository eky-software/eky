import type {
  InvoiceContentRevision,
  InvoiceRevisionKey,
  InvoiceScope,
} from '../domain/invoiceContentRevision.js';

export interface InvoiceContentRevisionReader {
  getCurrentRevision(scope: InvoiceScope): Promise<InvoiceContentRevision | undefined>;
  getRevision(key: InvoiceRevisionKey): Promise<InvoiceContentRevision | undefined>;
}
