import { describe, expect, it } from 'vitest';

import { readSmtpTestPreparationConfirmation } from './smtpTestConfirmation.js';

describe('readSmtpTestPreparationConfirmation', () => {
  it('reads only non-secret confirmation details', () => {
    expect(
      readSmtpTestPreparationConfirmation({
        preparation: {
          attachment: {
            fileName: 'lasku-20260001.pdf',
            sizeBytes: 2048,
          },
          attemptId: 'attempt-secret-capability',
          authorizationToken: 'one-time-secret',
          invoiceId: 'invoice-1',
          subject: 'Lasku 20260001',
          testRecipient: 'owner-test@example.fi',
        },
      }),
    ).toEqual({
      attachmentFileName: 'lasku-20260001.pdf',
      attachmentSizeBytes: 2048,
      invoiceId: 'invoice-1',
      subject: 'Lasku 20260001',
      testRecipient: 'owner-test@example.fi',
    });
  });

  it('rejects malformed or control-character confirmation data', () => {
    expect(
      readSmtpTestPreparationConfirmation({
        preparation: {
          attachment: { fileName: 'invoice.pdf', sizeBytes: 1 },
          invoiceId: 'invoice-1',
          subject: 'Invoice\nBcc: attacker@example.fi',
          testRecipient: 'owner@example.fi',
        },
      }),
    ).toBeUndefined();
  });
});
