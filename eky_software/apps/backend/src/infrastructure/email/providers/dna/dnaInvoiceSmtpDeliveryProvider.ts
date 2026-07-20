import {
  InvoiceSmtpDeliveryError,
  type InvoiceSmtpDeliveryProvider,
  type InvoiceSmtpEmailInput,
  type InvoiceSmtpEmailResult,
} from '../../../../modules/invoicing/ports/invoiceSmtpDeliveryProvider.js';
import { DnaSmtpEmailDeliveryProvider } from './dnaSmtpEmailDeliveryProvider.js';
import { DnaSmtpProviderError } from './dnaSmtpErrorMapper.js';

export class DnaInvoiceSmtpDeliveryProvider
  implements InvoiceSmtpDeliveryProvider
{
  constructor(
    private readonly provider: Pick<DnaSmtpEmailDeliveryProvider, 'sendEmail'>,
  ) {}

  async sendEmail(input: InvoiceSmtpEmailInput): Promise<InvoiceSmtpEmailResult> {
    try {
      if (input.emailDeliveryProvider !== 'dnaSmtp') {
        throw new InvoiceSmtpDeliveryError(
          'failed',
          'DNA_SMTP_CONFIGURATION_INVALID',
        );
      }

      return await this.provider.sendEmail({
        ...input,
        emailDeliveryProvider: 'dnaSmtp',
      });
    } catch (error) {
      if (error instanceof DnaSmtpProviderError) {
        throw new InvoiceSmtpDeliveryError(
          error.code === 'DNA_SMTP_DELIVERY_OUTCOME_UNKNOWN'
            ? 'outcomeUnknown'
            : 'failed',
          error.technicalErrorCode ?? error.code,
        );
      }

      if (error instanceof InvoiceSmtpDeliveryError) {
        throw error;
      }

      throw new InvoiceSmtpDeliveryError('failed', null);
    }
  }
}
