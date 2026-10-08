import type {
  InvoiceDeliveryMethod,
  InvoiceDeliveryProvider,
  InvoiceDeliveryStatus,
} from './invoiceDeliveryEvent.js';

export interface InvoiceDeliveryEventSummary {
  id: string;
  createdAt: string;
  deliveryMethod: InvoiceDeliveryMethod;
  provider: InvoiceDeliveryProvider;
  sendMode: 'customer' | 'smtpTest' | 'dryRun' | 'manual' | 'legacyUnknown';
  // Stored provenance only; the PDF read separately verifies document bytes.
  documentSource:
    | 'revision'
    | 'preservedLegacy'
    | 'legacyOriginal'
    | 'legacyMissingDocument';
  recipientEmail: string;
  ccEmail: string;
  safeErrorMessage: string | null;
  status: InvoiceDeliveryStatus;
}
