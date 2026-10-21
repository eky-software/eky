import { describe, expect, it } from 'vitest';

import {
  CustomerValidationError,
  assertCustomerTypeChangeAllowed,
  assertPropertyManagerReference,
  calculateNextCustomerNumber,
  normalizeCustomerName,
  normalizeCustomerNumber,
  normalizeManagedByCustomerId,
  parseCustomerHourlyRateOverrideCents,
  parseCustomerNumberMode,
  parseCustomerStatus,
  parseCustomerType,
} from './customerRules.js';

describe('normalizeCustomerName', () => {
  it('accepts a valid customer name', () => {
    expect(normalizeCustomerName('Example Customer Oy')).toBe('Example Customer Oy');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeCustomerName('  Example Customer Oy  ')).toBe('Example Customer Oy');
  });

  it('rejects an empty customer name', () => {
    expect(() => normalizeCustomerName('   ')).toThrow(CustomerValidationError);
  });

  it('rejects a customer name longer than 200 characters', () => {
    expect(() => normalizeCustomerName('A'.repeat(201))).toThrow(CustomerValidationError);
  });
});

describe('normalizeCustomerNumber', () => {
  it('accepts a valid customer number', () => {
    expect(normalizeCustomerNumber('1001')).toBe('1001');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeCustomerNumber('  1001  ')).toBe('1001');
  });

  it('rejects an empty customer number', () => {
    expect(() => normalizeCustomerNumber('   ')).toThrow(CustomerValidationError);
  });

  it('preserves 50-character manual numbers and rejects longer values', () => {
    expect(normalizeCustomerNumber('A'.repeat(50))).toBe('A'.repeat(50));
    expect(() => normalizeCustomerNumber('A'.repeat(51))).toThrow(CustomerValidationError);
  });
});

describe('calculateNextCustomerNumber', () => {
  it('retains the baseline and ignores non-numeric identifiers', () => {
    expect(calculateNextCustomerNumber([])).toBe('1001');
    expect(calculateNextCustomerNumber(['0000', '999', 'ABC-2000'])).toBe('1001');
    expect(calculateNextCustomerNumber(['0002000', '1999', 'ABC-9999'])).toBe('2001');
  });

  it('increments beyond safe Number precision without changing the source values', () => {
    const numbers = ['9007199254740992', '00002000'];
    expect(calculateNextCustomerNumber(numbers)).toBe('9007199254740993');
    expect(numbers).toEqual(['9007199254740992', '00002000']);
  });

  it('accepts a 50-digit result and rejects exhaustion', () => {
    expect(calculateNextCustomerNumber(['9'.repeat(49)])).toBe(`1${'0'.repeat(49)}`);
    expect(() => calculateNextCustomerNumber(['9'.repeat(50)]))
      .toThrow('Customer number range is exhausted.');
  });
});

describe('customer relationship invariants', () => {
  it('blocks only a referenced manager leaving the manager type', () => {
    expect(() => assertCustomerTypeChangeAllowed('propertyManager', 'company', true))
      .toThrow('Referenced property manager type cannot be changed.');
    expect(() => assertCustomerTypeChangeAllowed('propertyManager', 'propertyManager', true)).not.toThrow();
    expect(() => assertCustomerTypeChangeAllowed('propertyManager', 'company', false)).not.toThrow();
    expect(() => assertCustomerTypeChangeAllowed('company', 'propertyManager', false)).not.toThrow();
  });

  it('checks the reference without weakening self-reference or missing-manager errors', () => {
    expect(() => assertPropertyManagerReference('housing', '', undefined)).not.toThrow();
    expect(() => assertPropertyManagerReference('housing', 'manager', 'propertyManager')).not.toThrow();
    expect(() => assertPropertyManagerReference('housing', 'housing', 'propertyManager'))
      .toThrow('Customer cannot manage itself.');
    expect(() => assertPropertyManagerReference('housing', 'manager', 'company'))
      .toThrow('Managed by customer must be a property manager.');
    expect(() => assertPropertyManagerReference('housing', 'manager', undefined))
      .toThrow('Managed by customer must be a property manager.');
  });
});

describe('parseCustomerHourlyRateOverrideCents', () => {
  it('accepts null as unset value', () => {
    expect(parseCustomerHourlyRateOverrideCents(null)).toBeNull();
  });

  it('accepts zero as a real hourly rate override', () => {
    expect(parseCustomerHourlyRateOverrideCents(0)).toBe(0);
  });

  it('accepts positive whole cents', () => {
    expect(parseCustomerHourlyRateOverrideCents(6500)).toBe(6500);
  });

  it('rejects decimal cents', () => {
    expect(() => parseCustomerHourlyRateOverrideCents(65.5)).toThrow(CustomerValidationError);
  });

  it('rejects negative cents', () => {
    expect(() => parseCustomerHourlyRateOverrideCents(-1)).toThrow(CustomerValidationError);
  });
});

describe('parseCustomerNumberMode', () => {
  it('accepts known customer number modes', () => {
    expect(parseCustomerNumberMode('auto')).toBe('auto');
    expect(parseCustomerNumberMode('manual')).toBe('manual');
  });

  it('rejects unknown customer number modes', () => {
    expect(() => parseCustomerNumberMode('generated')).toThrow(CustomerValidationError);
  });
});

describe('parseCustomerType', () => {
  it('accepts known customer types', () => {
    expect(parseCustomerType('company')).toBe('company');
    expect(parseCustomerType('housingCompany')).toBe('housingCompany');
    expect(parseCustomerType('privatePerson')).toBe('privatePerson');
    expect(parseCustomerType('propertyManager')).toBe('propertyManager');
  });

  it('rejects unknown customer types', () => {
    expect(() => parseCustomerType('unknown')).toThrow(CustomerValidationError);
  });
});

describe('normalizeManagedByCustomerId', () => {
  it('keeps the property manager reference for housing companies', () => {
    expect(normalizeManagedByCustomerId('  customer-1  ', 'housingCompany')).toBe('customer-1');
  });

  it('clears the property manager reference for other customer types', () => {
    expect(normalizeManagedByCustomerId('customer-1', 'company')).toBe('');
  });
});

describe('parseCustomerStatus', () => {
  it('accepts known customer statuses', () => {
    expect(parseCustomerStatus('active')).toBe('active');
    expect(parseCustomerStatus('inactive')).toBe('inactive');
  });

  it('rejects unknown customer statuses', () => {
    expect(() => parseCustomerStatus('deleted')).toThrow(CustomerValidationError);
  });
});
