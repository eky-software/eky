import { describe, expect, it } from 'vitest';

import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';
import { normalizeCompanyEmailSecretInput } from './companyEmailSecretInput.js';

describe('normalizeCompanyEmailSecretInput', () => {
  it('normalizes the trusted company id without changing the secret', () => {
    expect(
      normalizeCompanyEmailSecretInput({
        companyId: '  example-company  ',
        secret: '  synthetic password  ',
      }),
    ).toEqual({
      companyId: 'example-company',
      secret: '  synthetic password  ',
    });
  });

  it.each([
    { companyId: '', secret: 'synthetic-password' },
    { companyId: 'company\nother', secret: 'synthetic-password' },
    { companyId: 'a'.repeat(201), secret: 'synthetic-password' },
  ])('rejects an invalid company id without exposing the secret', (input) => {
    expect(() => normalizeCompanyEmailSecretInput(input)).toThrow(
      CompanySettingsValidationError,
    );
  });

  it.each([
    undefined,
    null,
    123,
    '',
    `synthetic\u0000password`,
    'a'.repeat(1025),
  ])('rejects an invalid email secret', (secret) => {
    expect(() =>
      normalizeCompanyEmailSecretInput({
        companyId: 'example-company',
        secret,
      }),
    ).toThrow(CompanySettingsValidationError);
  });

  it('does not include the rejected secret in the error message', () => {
    const rejectedSecret = 'synthetic-secret-that-must-not-leak';

    expect(() =>
      normalizeCompanyEmailSecretInput({
        companyId: '',
        secret: rejectedSecret,
      }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(rejectedSecret),
      }),
    );
  });
});
