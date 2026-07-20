import { describe, expect, it } from 'vitest';

import { readInvoiceEmailPreparationConfirmation } from './invoiceEmailConfirmation.js';

describe('readInvoiceEmailPreparationConfirmation', () => {
  it('accepts only the safe fields needed by the native confirmation dialog', () => {
    expect(
      readInvoiceEmailPreparationConfirmation({
        preparation: {
          attachment: { fileName: 'lasku-20260001.pdf', sizeBytes: 2048 },
          attemptId: 'secret-attempt-id-is-not-forwarded',
          authorizationToken: 'secret-token-is-not-forwarded',
          cc: 'copy@example.fi',
          invoiceId: 'invoice-1',
          invoiceNumber: '20260001',
          recipient: 'customer@example.fi',
          resend: false,
          subject: 'Lasku 20260001',
        },
      }),
    ).toEqual({
      attachmentFileName: 'lasku-20260001.pdf',
      attachmentSizeBytes: 2048,
      cc: 'copy@example.fi',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      recipient: 'customer@example.fi',
      resend: false,
      subject: 'Lasku 20260001',
    });
  });

  it.each([
    { recipient: 'customer@example.fi\nBcc: attacker@example.fi' },
    { subject: 'Lasku\r\nBcc: attacker@example.fi' },
    { invoiceId: '../invoice-1' },
    { attachment: { fileName: 'invoice.pdf', sizeBytes: -1 } },
  ])('rejects malformed or control-character data: %o', (override) => {
    const preparation = {
      attachment: { fileName: 'lasku-20260001.pdf', sizeBytes: 2048 },
      cc: '',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      recipient: 'customer@example.fi',
      resend: false,
      subject: 'Lasku 20260001',
      ...override,
    };

    expect(
      readInvoiceEmailPreparationConfirmation({ preparation }),
    ).toBeUndefined();
  });
});
