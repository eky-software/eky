export type InvoiceEmailSendMode = 'customer' | 'smtpTest';

export interface PrepareInvoiceEmailSendAttemptInput {
  actorId: string;
  companyId: string;
  invoiceId: string;
  mode: InvoiceEmailSendMode;
  provider: 'dnaSmtp';
  recipient: string;
  requestFingerprint: string;
}

export interface PreparedInvoiceEmailSendAttempt {
  attemptId: string;
  authorizationToken: string;
  expiresAt: string;
}

export interface AcquireInvoiceEmailSendAttemptInput
  extends PrepareInvoiceEmailSendAttemptInput {
  attemptId: string;
  authorizationToken: string;
}

export type InvoiceEmailSendAttemptOutcome =
  | 'failed'
  | 'outcomeUnknown'
  | 'succeeded';

export interface CompleteInvoiceEmailSendAttemptInput {
  attemptId: string;
  outcome: InvoiceEmailSendAttemptOutcome;
}

export interface InvoiceEmailSendAttemptStore {
  acquire(input: AcquireInvoiceEmailSendAttemptInput): void;
  complete(input: CompleteInvoiceEmailSendAttemptInput): void;
  prepare(
    input: PrepareInvoiceEmailSendAttemptInput,
  ): PreparedInvoiceEmailSendAttempt;
}
