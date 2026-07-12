import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';

const maximumCompanyIdLength = 200;
const maximumSecretLength = 1024;

export interface NormalizeCompanyEmailSecretInput {
  companyId: string;
  secret: unknown;
}

export interface NormalizedCompanyEmailSecretInput {
  companyId: string;
  secret: string;
}

export function normalizeCompanyEmailSecretInput(
  input: NormalizeCompanyEmailSecretInput,
): NormalizedCompanyEmailSecretInput {
  return {
    companyId: normalizeCompanyId(input.companyId),
    secret: normalizeSecret(input.secret),
  };
}

function normalizeCompanyId(value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new CompanySettingsValidationError('Company id is required.');
  }

  if (normalizedValue.length > maximumCompanyIdLength) {
    throw new CompanySettingsValidationError(
      `Company id must be ${maximumCompanyIdLength} characters or less.`,
    );
  }

  if (/[\u0000-\u001f\u007f]/.test(normalizedValue)) {
    throw new CompanySettingsValidationError(
      'Company id contains unsupported control characters.',
    );
  }

  return normalizedValue;
}

function normalizeSecret(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CompanySettingsValidationError('Email secret must be text.');
  }

  if (value.length === 0) {
    throw new CompanySettingsValidationError('Email secret is required.');
  }

  if (value.length > maximumSecretLength) {
    throw new CompanySettingsValidationError(
      `Email secret must be ${maximumSecretLength} characters or less.`,
    );
  }

  if (value.includes('\u0000')) {
    throw new CompanySettingsValidationError(
      'Email secret contains an unsupported null character.',
    );
  }

  return value;
}
