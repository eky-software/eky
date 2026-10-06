import type { CustomerEmailCompletionInput, EmailCompletionResult } from '../domain/invoiceDeliveryReservation.js';

export interface InvoiceEmailDeliveryFinalizer {
  completeSuccessfulEmailDelivery(
    input: CustomerEmailCompletionInput,
  ): Promise<EmailCompletionResult>;
}
