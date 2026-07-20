import { describe, expect, it } from 'vitest';

import { uiText } from '../../../i18n/fi.js';
import { validateInvoiceEmailForm } from './invoiceEmailFormValidation.js';

describe('validateInvoiceEmailForm', () => {
  it('accepts edited recipient, copy, subject, and body values', () => {
    const result = validateInvoiceEmailForm({
      body: 'Tassa on asiakkaalle muokattu viesti.',
      cc: 'kopio@example.fi',
      subject: 'Muokattu laskun otsikko',
      to: 'uusi.vastaanottaja@example.fi',
    });

    expect(result).toEqual({ errors: {}, isValid: true });
  });

  it('allows an empty optional copy address', () => {
    expect(validateInvoiceEmailForm(createValidValues({ cc: '  ' })).isValid)
      .toBe(true);
  });

  it('rejects the same recipient and copy address case-insensitively', () => {
    const result = validateInvoiceEmailForm(createValidValues({
      cc: 'RECIPIENT@example.fi',
      to: 'recipient@example.fi',
    }));

    expect(result.errors.cc).toBe(
      uiText.invoicing.invoiceEmailCcSameAsRecipient,
    );
  });

  it.each(['karimu.dnainternet.net', 'copy @example.fi', 'copy@example']) (
    'rejects an invalid copy address %s with a field-specific message',
    (cc) => {
      const result = validateInvoiceEmailForm(createValidValues({ cc }));

      expect(result.errors.cc).toBe(uiText.invoicing.invoiceEmailCcInvalid);
      expect(result.errors.to).toBeUndefined();
    },
  );

  it('requires a valid recipient address', () => {
    const missing = validateInvoiceEmailForm(createValidValues({ to: '' }));
    const invalid = validateInvoiceEmailForm(
      createValidValues({ to: 'recipient.example.fi' }),
    );

    expect(missing.errors.to).toBe(
      uiText.invoicing.invoiceEmailRecipientRequired,
    );
    expect(invalid.errors.to).toBe(
      uiText.invoicing.invoiceEmailRecipientInvalid,
    );
  });

  it('requires subject and body content', () => {
    const result = validateInvoiceEmailForm(
      createValidValues({ body: ' ', subject: '' }),
    );

    expect(result.errors.subject).toBe(
      uiText.invoicing.invoiceEmailSubjectRequired,
    );
    expect(result.errors.body).toBe(uiText.invoicing.invoiceEmailBodyRequired);
  });

  it('rejects header control characters and overlong content', () => {
    const result = validateInvoiceEmailForm(
      createValidValues({
        body: 'a'.repeat(10_001),
        subject: 'Lasku\nBcc: hidden@example.fi',
      }),
    );

    expect(result.errors.subject).toBe(
      uiText.invoicing.invoiceEmailSubjectInvalid,
    );
    expect(result.errors.body).toBe(uiText.invoicing.invoiceEmailBodyTooLong);
  });
});

function createValidValues(
  overrides: Partial<{
    body: string;
    cc: string;
    subject: string;
    to: string;
  }> = {},
) {
  return {
    body: 'Liitteena lasku.',
    cc: 'copy@example.fi',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
    ...overrides,
  };
}
