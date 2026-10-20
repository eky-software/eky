import { describe, expect, it } from 'vitest';

import { EkyApiError } from '../http.js';
import { getCompanyEmailSecretErrorCode } from './companyEmailSecretError.js';

describe('company email secret failure contract', () => {
  const body = { error: 'Email secret storage is unavailable.', code: 'COMPANY_EMAIL_SECRET_OPERATION_FAILED' };

  it.each([
    'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
    'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN',
    'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE',
  ])('recognizes only the declared 503 outcome: %s', (code) => {
    expect(getCompanyEmailSecretErrorCode(new EkyApiError(body.error, {
      status: 503, responseBody: { ...body, code },
    }))).toBe(code);
  });

  it.each([
    null, [], {}, { code: body.code }, { ...body, code: 'UNKNOWN' },
    { ...body, error: null }, { ...body, secret: 'synthetic-not-returned' },
    Object.create(body),
  ])('does not infer a known outcome from an invalid response', (responseBody) => {
    expect(getCompanyEmailSecretErrorCode(new EkyApiError('Request failed.', {
      status: 503, responseBody,
    }))).toBeUndefined();
  });

  it('does not infer a no-effect outcome from the message, status or a foreign object', () => {
    expect(getCompanyEmailSecretErrorCode(new Error(body.code))).toBeUndefined();
    expect(getCompanyEmailSecretErrorCode({ status: 503, responseBody: body })).toBeUndefined();
    expect(getCompanyEmailSecretErrorCode(new EkyApiError(body.error, {
      status: 500, responseBody: body,
    }))).toBeUndefined();
  });
});
