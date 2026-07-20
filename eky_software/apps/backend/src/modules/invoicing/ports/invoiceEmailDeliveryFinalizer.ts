export interface CompleteSuccessfulInvoiceEmailDeliveryInput {
  companyId: string;
  eventId: string;
  invoiceId: string;
  providerMessageId: string | null;
  sentAt: string;
}

export interface CompleteSuccessfulInvoiceEmailDeliveryResult {
  invoiceStatus: 'sent';
  wasResend: boolean;
}

export interface InvoiceEmailDeliveryFinalizer {
  completeSuccessfulEmailDelivery(
    input: CompleteSuccessfulInvoiceEmailDeliveryInput,
  ): Promise<CompleteSuccessfulInvoiceEmailDeliveryResult>;
}
