import { describe, expect, it } from 'vitest';

import { InvoiceNumberingError } from './invoiceNumberingError.js';
import {
  createFinnishDomesticReferenceNumber,
  validateFinnishDomesticReferenceNumber,
} from './invoiceReferenceNumber.js';

describe('createFinnishDomesticReferenceNumber', () => {
  it('creates the Finnish domestic reference check digit', () => {
    expect(createFinnishDomesticReferenceNumber('123')).toBe('1232');
    expect(createFinnishDomesticReferenceNumber('1234')).toBe('12344');
    expect(createFinnishDomesticReferenceNumber('12345')).toBe('123453');
  });

  it('rejects an empty base', () => {
    expect(() => createFinnishDomesticReferenceNumber('')).toThrow(
      InvoiceNumberingError,
    );
  });

  it('rejects non-numeric bases without silently stripping characters', () => {
    expect(() => createFinnishDomesticReferenceNumber('2027-0001')).toThrow(
      InvoiceNumberingError,
    );
    expect(() => createFinnishDomesticReferenceNumber('ABC123')).toThrow(
      InvoiceNumberingError,
    );
  });

  it('rejects bases that would create a reference number longer than 20 digits', () => {
    expect(() =>
      createFinnishDomesticReferenceNumber('12345678901234567890'),
    ).toThrow(InvoiceNumberingError);
  });
});

describe('validateFinnishDomesticReferenceNumber', () => {
  it('accepts a valid Finnish domestic reference number', () => {
    expect(() => validateFinnishDomesticReferenceNumber('123453')).not.toThrow();
  });

  it('rejects a reference number with an invalid check digit', () => {
    expect(() => validateFinnishDomesticReferenceNumber('123454')).toThrow(
      InvoiceNumberingError,
    );
  });

  it('rejects a value without a separate check digit', () => {
    expect(() => validateFinnishDomesticReferenceNumber('1')).toThrow(
      InvoiceNumberingError,
    );
  });
});
