import { describe, expect, it } from 'vitest';

import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';
import {
  getInvoiceTaxTreatmentSnapshot,
  requireReverseChargeCustomerEligibility,
  resolveInvoiceTaxTreatment,
} from './invoiceTaxTreatment.js';

describe('invoice tax treatment', () => {
  it('uses normal VAT as the backwards-compatible default', () => {
    expect(resolveInvoiceTaxTreatment(undefined)).toBe('normalVat');
    expect(resolveInvoiceTaxTreatment('normalVat')).toBe('normalVat');
  });

  it('accepts only the explicit construction reverse-charge value', () => {
    expect(resolveInvoiceTaxTreatment('reverseChargeConstruction')).toBe(
      'reverseChargeConstruction',
    );
    expect(() => resolveInvoiceTaxTreatment('zeroVat')).toThrow(
      InvoiceDraftValidationError,
    );
  });

  it('requires a non-private legal buyer with a business id', () => {
    expect(() =>
      requireReverseChargeCustomerEligibility({
        customerType: 'company',
        businessId: '1234567-8',
      }),
    ).not.toThrow();
    expect(() =>
      requireReverseChargeCustomerEligibility({
        customerType: 'privatePerson',
        businessId: '1234567-8',
      }),
    ).toThrow(InvoiceDraftValidationError);
    expect(() =>
      requireReverseChargeCustomerEligibility({
        customerType: 'company',
        businessId: '   ',
      }),
    ).toThrow(InvoiceDraftValidationError);
  });

  it('provides immutable reverse-charge snapshot labels', () => {
    expect(
      getInvoiceTaxTreatmentSnapshot('reverseChargeConstruction'),
    ).toEqual({
      label: 'Käännetty verovelvollisuus',
      legalBasis: 'AVL 8 c §',
    });
    expect(getInvoiceTaxTreatmentSnapshot('normalVat')).toEqual({
      label: '',
      legalBasis: '',
    });
  });
});
