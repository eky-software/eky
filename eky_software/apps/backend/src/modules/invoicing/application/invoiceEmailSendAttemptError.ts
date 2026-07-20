export type InvoiceEmailSendAttemptErrorCode =
  | 'cooldown'
  | 'inProgress'
  | 'invalidOrExpired';

export class InvoiceEmailSendAttemptError extends Error {
  constructor(public readonly code: InvoiceEmailSendAttemptErrorCode) {
    super(
      code === 'cooldown'
        ? 'Invoice email delivery is temporarily rate limited.'
        : code === 'inProgress'
          ? 'An invoice email delivery is already in progress.'
          : 'Invoice email delivery authorization is invalid or expired.',
    );
    this.name = 'InvoiceEmailSendAttemptError';
  }
}
