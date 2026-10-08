import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import type { InvoiceDeliveryReservation, OtherEmailCompletionInput, EmailCompletionResult } from '../domain/invoiceDeliveryReservation.js';

export type ReservedEmailFields = Readonly<{
  recipientEmail: string;
  ccEmail: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
  createdBy: string;
}>;
export type ReserveEmailDeliveryInput = InvoiceDeliveryReservation & ReservedEmailFields;
export type ReserveEmailDeliveryResult =
  | Readonly<{
      outcome: 'reserved';
      reservation: InvoiceDeliveryReservation;
      invoiceStatusAtReservation: 'approved' | 'sent';
    }>
  | Readonly<{ outcome: 'conflict' }>;

export interface InvoiceDeliveryEventRepository {
  reserveEmailDelivery(input: ReserveEmailDeliveryInput): Promise<ReserveEmailDeliveryResult>;
  completeDeliveryEvent(input: OtherEmailCompletionInput): Promise<EmailCompletionResult>;
  saveDeliveryEvent(
    event: InvoiceDryRunDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent>;
}
