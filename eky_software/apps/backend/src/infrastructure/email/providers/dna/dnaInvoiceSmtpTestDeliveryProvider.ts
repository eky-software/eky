import {
  InvoiceSmtpTestDeliveryError,
  type InvoiceSmtpTestDeliveryProvider,
  type InvoiceSmtpTestEmailInput,
  type InvoiceSmtpTestEmailResult,
} from '../../../../modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import { DnaSmtpEmailDeliveryProvider } from './dnaSmtpEmailDeliveryProvider.js';
import { DnaSmtpProviderError } from './dnaSmtpErrorMapper.js';

export class DnaInvoiceSmtpTestDeliveryProvider
  implements InvoiceSmtpTestDeliveryProvider
{
  constructor(
    private readonly provider: Pick<
      DnaSmtpEmailDeliveryProvider,
      'sendTestEmail'
    >,
  ) {}

  async sendTestEmail(
    input: InvoiceSmtpTestEmailInput,
  ): Promise<InvoiceSmtpTestEmailResult> {
    try {
      if (input.emailDeliveryProvider !== 'dnaSmtp') {
        throw new InvoiceSmtpTestDeliveryError(
          'failed',
          'DNA_SMTP_CONFIGURATION_INVALID',
        );
      }

      return await this.provider.sendTestEmail({
        ...input,
        emailDeliveryProvider: 'dnaSmtp',
      });
    } catch (error) {
      if (error instanceof DnaSmtpProviderError) {
        throw new InvoiceSmtpTestDeliveryError(
          error.code === 'DNA_SMTP_DELIVERY_OUTCOME_UNKNOWN'
            ? 'outcomeUnknown'
            : 'failed',
          error.technicalErrorCode ?? error.code,
        );
      }

      throw new InvoiceSmtpTestDeliveryError('failed', null);
    }
  }
}
