import { EkyApiError, isRecord } from '../http.js';

export type CompanyEmailSecretErrorCode =
  | 'COMPANY_EMAIL_SECRET_OPERATION_FAILED'
  | 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN'
  | 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE';

export function getCompanyEmailSecretErrorCode(error: unknown): CompanyEmailSecretErrorCode | undefined {
  if (!(error instanceof EkyApiError) || error.status !== 503) return undefined;
  const body = error.responseBody;
  if (!isRecord(body) || Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, 'error') || !Object.hasOwn(body, 'code') || typeof body.error !== 'string') {
    return undefined;
  }
  switch (body.code) {
    case 'COMPANY_EMAIL_SECRET_OPERATION_FAILED':
    case 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN':
    case 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE':
      return body.code;
    default:
      return undefined;
  }
}
