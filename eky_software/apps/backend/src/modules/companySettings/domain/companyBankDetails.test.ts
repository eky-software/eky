import { describe, expect, it } from 'vitest';

import {
  normalizeCompanyBankDetails,
  validateCompanyBankDetails,
} from './companyBankDetails.js';
import { CompanySettingsValidationError } from './companySettingsRules.js';

describe('normalizeCompanyBankDetails', () => {
  it('allows empty bank details', () => {
    expect(
      normalizeCompanyBankDetails({
        iban: '   ',
        bic: '   ',
        bankName: '   ',
      }),
    ).toEqual({
      iban: '',
      bic: '',
      bankName: '',
    });
  });

  it('normalizes IBAN, BIC and bank name', () => {
    expect(
      normalizeCompanyBankDetails({
        iban: ' fi21 1234 5600 0007 85 ',
        bic: ' ndeafihh ',
        bankName: '  Test Bank  ',
      }),
    ).toEqual({
      iban: 'FI2112345600000785',
      bic: 'NDEAFIHH',
      bankName: 'Test Bank',
    });
  });

  it('rejects an invalid IBAN checksum', () => {
    expect(() =>
      normalizeCompanyBankDetails({
        iban: 'FI2112345600000786',
        bic: '',
        bankName: '',
      }),
    ).toThrow(CompanySettingsValidationError);
  });

  it('rejects an invalid BIC', () => {
    expect(() =>
      normalizeCompanyBankDetails({
        iban: '',
        bic: 'bad',
        bankName: '',
      }),
    ).toThrow(CompanySettingsValidationError);
  });

  it('rejects a too long bank name', () => {
    expect(() =>
      normalizeCompanyBankDetails({
        iban: '',
        bic: '',
        bankName: 'A'.repeat(201),
      }),
    ).toThrow(CompanySettingsValidationError);
  });
});

describe('validateCompanyBankDetails', () => {
  it('accepts a valid normalized IBAN', () => {
    expect(() =>
      validateCompanyBankDetails({
        iban: 'FI2112345600000785',
        bic: '',
        bankName: '',
      }),
    ).not.toThrow();
  });
});
