import { describe, expect, it } from 'vitest';

import {
  CustomerValidationError,
  normalizeCustomerName,
  normalizeCustomerNumber,
  normalizeManagedByCustomerId,
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
