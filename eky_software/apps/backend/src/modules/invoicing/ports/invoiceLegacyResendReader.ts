import type {
  LegacyOriginalInvoiceDocumentMetadata,
  PreservedLegacyInvoiceDocumentMetadata,
} from '../domain/approvedInvoiceDocument.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';

export interface InvoiceLegacyResendDocuments {
  readonly source: LegacyOriginalInvoiceDocumentMetadata;
  readonly preserved: PreservedLegacyInvoiceDocumentMetadata | undefined;
}

export interface InvoiceLegacyResendReader {
  // Eligibility is rechecked at publication and reservation; this read does not authorize sending.
  findDocuments(scope: InvoiceScope): Promise<InvoiceLegacyResendDocuments | undefined>;
}
