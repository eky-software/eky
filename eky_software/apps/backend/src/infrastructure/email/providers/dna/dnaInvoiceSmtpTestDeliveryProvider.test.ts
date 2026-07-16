import { describe, expect, it } from 'vitest';

import { InvoiceSmtpTestDeliveryError } from '../../../../modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import { DnaInvoiceSmtpTestDeliveryProvider } from './dnaInvoiceSmtpTestDeliveryProvider.js';
import { DnaSmtpProviderError } from './dnaSmtpErrorMapper.js';

describe('DnaInvoiceSmtpTestDeliveryProvider', () => {
  it('returns the restricted DNA provider result unchanged', async () => {
    const result = {
      deliveredTo: 'safe-test@example.fi',
      provider: 'smtp' as const,
      providerMessageId: '<message-1@example.fi>',
      testMode: true as const,
    };
    const provider = new DnaInvoiceSmtpTestDeliveryProvider({
      sendTestEmail: async () => result,
    });

    await expect(provider.sendTestEmail(createInput())).resolves.toBe(result);
  });

  it('preserves an unknown delivery outcome without exposing provider details', async () => {
    const provider = new DnaInvoiceSmtpTestDeliveryProvider({
      sendTestEmail: async () => {
        throw new DnaSmtpProviderError(
          'DNA_SMTP_DELIVERY_OUTCOME_UNKNOWN',
          'SMTP_OUTCOME_UNKNOWN',
        );
      },
    });

    const error = await provider.sendTestEmail(createInput()).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toBeInstanceOf(InvoiceSmtpTestDeliveryError);
    expect(error).toMatchObject({
      outcome: 'outcomeUnknown',
      technicalErrorCode: 'SMTP_OUTCOME_UNKNOWN',
    });
    expect(String(error)).not.toContain('safe-test@example.fi');
  });

  it('maps unknown failures to a safe failed outcome', async () => {
    const provider = new DnaInvoiceSmtpTestDeliveryProvider({
      sendTestEmail: async () => {
        throw new Error('synthetic provider internals');
      },
    });

    await expect(provider.sendTestEmail(createInput())).rejects.toMatchObject({
      outcome: 'failed',
      technicalErrorCode: null,
    });
  });
});

function createInput() {
  return {
    attemptId: 'attempt-1',
    body: 'Synthetic message',
    companyId: 'company-1',
    emailDeliveryProvider: 'dnaSmtp' as const,
    emailSenderAddress: 'billing@example.fi',
    emailSenderName: 'Example Builder Oy',
    emailTestRecipientOverride: 'safe-test@example.fi',
    emailUsername: 'billing@example.fi',
    pdfContent: Buffer.from('%PDF-1.7\nsynthetic', 'ascii'),
    pdfFileName: 'invoice-2026001.pdf',
    subject: 'Invoice 2026001',
  };
}
