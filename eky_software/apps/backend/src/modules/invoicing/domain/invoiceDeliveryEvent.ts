export const invoiceDeliveryMethods = ['email', 'manual', 'print', 'other'] as const;
export const invoiceDeliveryProviders = [
  'dryRun',
  'smtp',
  'gmail',
  'microsoft',
  'manual',
  'other',
] as const;
export const invoiceDeliveryStatuses = [
  'prepared',
  'attempted',
  'succeeded',
  'failed',
  'outcomeUnknown',
] as const;

export type InvoiceDeliveryMethod = (typeof invoiceDeliveryMethods)[number];
export type InvoiceDeliveryProvider = (typeof invoiceDeliveryProviders)[number];
export type InvoiceDeliveryStatus = (typeof invoiceDeliveryStatuses)[number];

export interface InvoiceDeliveryEvent {
  id: string;
  companyId: string;
  invoiceId: string;
  documentId: string | null;
  deliveryMethod: InvoiceDeliveryMethod;
  provider: InvoiceDeliveryProvider;
  status: InvoiceDeliveryStatus;
  recipientEmail: string;
  ccEmail: string;
  subject: string;
  bodyPreview: string;
  providerMessageId: string | null;
  safeErrorMessage: string | null;
  technicalErrorCode: string | null;
  createdAt: string;
  createdBy: string;
}
