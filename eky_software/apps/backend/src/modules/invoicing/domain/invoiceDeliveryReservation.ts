import type { InvoiceScope } from './invoiceContentRevision.js';
import type { PreservedLegacyInvoiceDocumentBinding, RevisionInvoiceDocumentBinding } from './invoiceDocumentBinding.js';

export type InvoiceDeliveryDocumentEvidence = Readonly<{
  documentId: string;
  sha256: string;
  sizeBytes: number;
}>;
export type RevisionInvoiceDeliveryTarget = InvoiceScope & InvoiceDeliveryDocumentEvidence & RevisionInvoiceDocumentBinding;
export type PreservedLegacyInvoiceDeliveryTarget = InvoiceScope & InvoiceDeliveryDocumentEvidence & PreservedLegacyInvoiceDocumentBinding;
export type InvoiceDeliveryTarget = RevisionInvoiceDeliveryTarget | PreservedLegacyInvoiceDeliveryTarget;

export type InvoiceDeliveryReservation =
  | Readonly<{ eventId: string; mode: 'customer'; target: InvoiceDeliveryTarget }>
  | Readonly<{ eventId: string; mode: 'smtpTest'; target: RevisionInvoiceDeliveryTarget }>;

export type EmailDeliverySuccess = Readonly<{
  status: 'succeeded';
  providerMessageId: string | null;
}>;
export type EmailDeliveryUnsuccessfulOutcome = Readonly<{
  status: 'failed' | 'outcomeUnknown';
  safeErrorMessage: string | null;
  technicalErrorCode: string | null;
}>;
export type EmailCompletionResult = Readonly<{ outcome: 'completed' | 'alreadyCompleted' }>;
export type CustomerEmailCompletionInput = Readonly<{
  reservation: Extract<InvoiceDeliveryReservation, { mode: 'customer' }>;
  result: EmailDeliverySuccess;
}>;
export type OtherEmailCompletionInput =
  | Readonly<{
      reservation: Extract<InvoiceDeliveryReservation, { mode: 'smtpTest' }>;
      result: EmailDeliverySuccess;
    }>
  | Readonly<{
      reservation: InvoiceDeliveryReservation;
      result: EmailDeliveryUnsuccessfulOutcome;
    }>;
