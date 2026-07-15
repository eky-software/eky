import { describe, expect, it } from 'vitest';

import {
  EmailAddressValidationError,
  normalizeEmailAddress,
} from './emailAddress.js';

describe('normalizeEmailAddress', () => {
  it('trims the address and normalizes only the domain', () => {
    expect(normalizeEmailAddress('  Billing.User@EXAMPLE.COM  ')).toBe(
      'Billing.User@example.com',
    );
  });

  it.each([
    '',
    'missing-at.example.com',
    'two@@example.com',
    '.leading@example.com',
    'trailing.@example.com',
    'double..dot@example.com',
    'user@example',
    'user@-example.com',
    'user@example-.com',
    'user\r\nBcc: victim@example.com',
    'Nimi <user@example.com>',
    'ääkkönen@example.com',
  ])('rejects an unsafe or unsupported address: %s', (value) => {
    expect(() => normalizeEmailAddress(value)).toThrow(
      EmailAddressValidationError,
    );
  });
});
