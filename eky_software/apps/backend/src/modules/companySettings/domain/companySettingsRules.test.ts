import { describe, expect, it } from 'vitest';

import {
  CompanySettingsValidationError,
  normalizeCompanySettingsField,
  normalizeCompanyVatNumber,
  normalizeHourlyRateShortcut,
  parseDefaultHourlyRateCents,
} from './companySettingsRules.js';

describe('normalizeCompanySettingsField', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCompanySettingsField('  Example Oy  ', 'Company name')).toBe('Example Oy');
  });

  it('allows empty optional fields', () => {
    expect(normalizeCompanySettingsField('   ', 'Company phone')).toBe('');
  });

  it('rejects values longer than 200 characters', () => {
    expect(() => normalizeCompanySettingsField('A'.repeat(201), 'Company name')).toThrow(
      CompanySettingsValidationError,
    );
  });
});

describe('normalizeCompanyVatNumber', () => {
  it('allows an empty VAT number', () => {
    expect(normalizeCompanyVatNumber('   ')).toBe('');
  });

  it('trims and uppercases a Finnish VAT number', () => {
    expect(normalizeCompanyVatNumber('  fi12345678  ')).toBe('FI12345678');
  });

  it('rejects invalid VAT numbers', () => {
    expect(() => normalizeCompanyVatNumber('1234567-8')).toThrow(
      CompanySettingsValidationError,
    );
    expect(() => normalizeCompanyVatNumber('FI1234567')).toThrow(
      CompanySettingsValidationError,
    );
    expect(() => normalizeCompanyVatNumber('SE12345678')).toThrow(
      CompanySettingsValidationError,
    );
  });
});

describe('normalizeHourlyRateShortcut', () => {
  it('trims the shortcut and allows an empty value', () => {
    expect(normalizeHourlyRateShortcut('  työ  ')).toBe('työ');
    expect(normalizeHourlyRateShortcut('   ')).toBe('');
  });

  it('rejects a shortcut longer than 50 characters', () => {
    expect(() => normalizeHourlyRateShortcut('A'.repeat(51))).toThrow(
      CompanySettingsValidationError,
    );
  });

  it('rejects a multiline shortcut', () => {
    expect(() => normalizeHourlyRateShortcut('työ\nlaskutus')).toThrow(
      CompanySettingsValidationError,
    );
  });
});

describe('parseDefaultHourlyRateCents', () => {
  it('accepts null as unset value', () => {
    expect(parseDefaultHourlyRateCents(null)).toBeNull();
  });

  it('accepts zero as a real hourly rate', () => {
    expect(parseDefaultHourlyRateCents(0)).toBe(0);
  });

  it('accepts positive whole cents', () => {
    expect(parseDefaultHourlyRateCents(6500)).toBe(6500);
  });

  it('rejects decimal cents', () => {
    expect(() => parseDefaultHourlyRateCents(65.5)).toThrow(CompanySettingsValidationError);
  });

  it('rejects negative cents', () => {
    expect(() => parseDefaultHourlyRateCents(-1)).toThrow(CompanySettingsValidationError);
  });
});
