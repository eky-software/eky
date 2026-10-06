import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';

export type InvoiceEventDocument =
  | Readonly<{ kind: 'document'; document: StoredInvoiceDocumentMetadata }>
  | Readonly<{ kind: 'legacyMissingDocument' }>;

export interface InvoiceDeliveryEventReader {
  requiresLegacyDeliveryReview(scope: InvoiceScope): Promise<boolean>;
  hasInvoiceIdentity(scope: InvoiceScope): Promise<boolean>;
  findEventDocument(scope: InvoiceScope, eventId: string): Promise<InvoiceEventDocument | undefined>;
  hasUnresolvedDeliveryEvent(
    companyId: string,
    invoiceId: string,
  ): Promise<boolean>;
  listDeliveryEvents(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoiceDeliveryEventSummary[]>;
}
