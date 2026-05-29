import { describe, expect, it } from 'vitest';

import {
  CustomerValidationError,
  normalizeCustomerName,
  normalizeCustomerNumber,
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

describe('parseCustomerType', () => {
  it('accepts known customer types', () => {
    expect(parseCustomerType('company')).toBe('company');
    expect(parseCustomerType('privatePerson')).toBe('privatePerson');
  });

  it('rejects unknown customer types', () => {
    expect(() => parseCustomerType('unknown')).toThrow(CustomerValidationError);
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
