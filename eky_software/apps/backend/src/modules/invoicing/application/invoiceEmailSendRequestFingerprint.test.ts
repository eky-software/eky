import { describe, expect, it } from 'vitest';

import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';

describe('createInvoiceEmailSendRequestFingerprint', () => {
  it('changes when either the displayed or actual recipient changes', () => {
    const baseInput = {
      body: 'Hei, liitteenä lasku.',
      cc: '',
      recipient: 'forced-test@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    };
    const fingerprint = createInvoiceEmailSendRequestFingerprint(baseInput);

    expect(
      createInvoiceEmailSendRequestFingerprint({
        ...baseInput,
        to: 'changed@example.fi',
      }),
    ).not.toBe(fingerprint);
    expect(
      createInvoiceEmailSendRequestFingerprint({
        ...baseInput,
        recipient: 'other-test@example.fi',
      }),
    ).not.toBe(fingerprint);
  });
});
