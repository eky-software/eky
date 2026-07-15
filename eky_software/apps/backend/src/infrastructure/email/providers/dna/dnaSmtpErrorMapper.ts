import {
  InvoiceMimeMessageValidationError,
} from '../../mime/invoiceMimeMessageBuilder.js';
import { SmtpTransportError } from '../../smtp/smtpErrors.js';

export const dnaSmtpProviderErrorCodes = [
  'DNA_SMTP_CONFIGURATION_INVALID',
  'DNA_SMTP_DELIVERY_FAILED',
  'DNA_SMTP_DELIVERY_OUTCOME_UNKNOWN',
  'DNA_SMTP_MESSAGE_INVALID',
  'DNA_SMTP_SECRET_NOT_CONFIGURED',
] as const;

export type DnaSmtpProviderErrorCode =
  (typeof dnaSmtpProviderErrorCodes)[number];

export class DnaSmtpProviderError extends Error {
  constructor(
    public readonly code: DnaSmtpProviderErrorCode,
    public readonly technicalErrorCode: string | null = null,
  ) {
    super('DNA SMTP test delivery failed.');
    this.name = 'DnaSmtpProviderError';
  }
}

export function mapDnaSmtpProviderError(error: unknown): DnaSmtpProviderError {
  if (error instanceof DnaSmtpProviderError) {
    return error;
  }

  if (error instanceof InvoiceMimeMessageValidationError) {
    return new DnaSmtpProviderError('DNA_SMTP_MESSAGE_INVALID');
  }

  if (error instanceof SmtpTransportError) {
    return new DnaSmtpProviderError(
      error.outcome === 'outcomeUnknown'
        ? 'DNA_SMTP_DELIVERY_OUTCOME_UNKNOWN'
        : 'DNA_SMTP_DELIVERY_FAILED',
      error.code,
    );
  }

  return new DnaSmtpProviderError('DNA_SMTP_DELIVERY_FAILED');
}
