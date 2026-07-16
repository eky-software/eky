export interface PrepareInvoiceSmtpTestAttemptInput {
  actorId: string;
  companyId: string;
  invoiceId: string;
  provider: 'dnaSmtp';
  requestFingerprint: string;
  testRecipient: string;
}

export interface PreparedInvoiceSmtpTestAttempt {
  attemptId: string;
  authorizationToken: string;
  expiresAt: string;
}

export interface AcquireInvoiceSmtpTestAttemptInput
  extends PrepareInvoiceSmtpTestAttemptInput {
  attemptId: string;
  authorizationToken: string;
}

export type InvoiceSmtpTestAttemptOutcome =
  | 'failed'
  | 'outcomeUnknown'
  | 'succeeded';

export interface CompleteInvoiceSmtpTestAttemptInput {
  attemptId: string;
  outcome: InvoiceSmtpTestAttemptOutcome;
}

export interface InvoiceSmtpTestAttemptStore {
  acquire(input: AcquireInvoiceSmtpTestAttemptInput): void;
  complete(input: CompleteInvoiceSmtpTestAttemptInput): void;
  prepare(
    input: PrepareInvoiceSmtpTestAttemptInput,
  ): PreparedInvoiceSmtpTestAttempt;
}
