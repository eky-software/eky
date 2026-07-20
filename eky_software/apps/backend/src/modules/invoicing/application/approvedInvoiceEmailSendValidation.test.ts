import { describe, expect, it } from 'vitest';

import { normalizeApprovedInvoiceEmailSendFields } from './approvedInvoiceEmailSendValidation.js';

describe('normalizeApprovedInvoiceEmailSendFields', () => {
  it('normalizes valid customer delivery fields', () => {
    expect(
      normalizeApprovedInvoiceEmailSendFields({
        body: ' Hei,\n\nliitteenä lasku. ',
        cc: ' copy@EXAMPLE.FI ',
        subject: ' Lasku 20260001 ',
        to: ' customer@EXAMPLE.FI ',
      }),
    ).toEqual({
      body: 'Hei,\n\nliitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    });
  });

  it.each([
    { subject: 'Lasku\r\nBcc: attacker@example.fi' },
    { to: 'customer@example.fi\nBcc: attacker@example.fi' },
    { to: 'Customer <customer@example.fi>' },
    { cc: 'copy@example.fi,attacker@example.fi' },
  ])('rejects header injection and unsupported address syntax: %o', (override) => {
    expect(() =>
      normalizeApprovedInvoiceEmailSendFields({
        body: 'Hei',
        cc: '',
        subject: 'Lasku 20260001',
        to: 'customer@example.fi',
        ...override,
      }),
    ).toThrow();
  });

  it('rejects the same normalized address in To and Cc', () => {
    expect(() =>
      normalizeApprovedInvoiceEmailSendFields({
        body: 'Hei',
        cc: ' CUSTOMER@example.fi ',
        subject: 'Lasku 20260001',
        to: 'customer@example.fi',
      }),
    ).toThrow('Recipient email and Cc email must be different.');
  });
});
