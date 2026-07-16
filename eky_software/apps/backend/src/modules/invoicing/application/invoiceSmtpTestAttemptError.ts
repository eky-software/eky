export type InvoiceSmtpTestAttemptErrorCode =
  | 'cooldown'
  | 'invalidOrExpired'
  | 'inProgress';

export class InvoiceSmtpTestAttemptError extends Error {
  constructor(readonly code: InvoiceSmtpTestAttemptErrorCode) {
    super(
      code === 'cooldown'
        ? 'Invoice SMTP test delivery is temporarily unavailable.'
        : code === 'inProgress'
          ? 'Invoice SMTP test delivery is already in progress.'
          : 'Invoice SMTP test authorization is invalid or expired.',
    );
    this.name = 'InvoiceSmtpTestAttemptError';
  }
}
