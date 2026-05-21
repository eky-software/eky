import { describe, expect, it } from 'vitest';

import { CustomerValidationError, normalizeCustomerName } from './customerRules.js';

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
