import { describe, expect, it } from 'vitest';

import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';
import { normalizeOptionalRefundIban } from './invoiceRefundIban.js';

describe('normalizeOptionalRefundIban', () => {
  it('accepts an empty optional value', () => {
    expect(normalizeOptionalRefundIban('   ')).toBe('');
  });

  it('normalizes and validates an IBAN', () => {
    expect(normalizeOptionalRefundIban(' fi21 1234 5600 0007 85 ')).toBe(
      'FI2112345600000785',
    );
  });

  it('rejects an invalid checksum and malformed value', () => {
    expect(() =>
      normalizeOptionalRefundIban('FI2112345600000786'),
    ).toThrow(InvoiceDraftValidationError);
    expect(() => normalizeOptionalRefundIban('not-an-iban')).toThrow(
      InvoiceDraftValidationError,
    );
  });
});
