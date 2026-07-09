import { CompanySettingsValidationError } from './companySettingsRules.js';

export type EmailDeliveryProvider = 'dryRun' | 'smtp';
export type EmailSmtpSecurity = 'tls' | 'starttls';

export interface CompanyEmailSettingsInput {
  emailDeliveryProvider: string;
  emailSenderName: string;
  emailSenderAddress: string;
  emailSmtpHost: string;
  emailSmtpPort: unknown;
  emailSmtpSecurity: string;
  emailUsername: string;
  emailTestRecipientOverride: string;
}

export interface NormalizedCompanyEmailSettings {
  emailDeliveryProvider: EmailDeliveryProvider;
  emailSenderName: string;
  emailSenderAddress: string;
  emailSmtpHost: string;
  emailSmtpPort: number | null;
  emailSmtpSecurity: EmailSmtpSecurity;
  emailUsername: string;
  emailTestRecipientOverride: string;
}

export function normalizeCompanyEmailSettings(
  input: CompanyEmailSettingsInput,
): NormalizedCompanyEmailSettings {
  return {
    emailDeliveryProvider: normalizeEmailDeliveryProvider(input.emailDeliveryProvider),
    emailSenderName: normalizeSingleLineText(input.emailSenderName, 'Email sender name', 200),
    emailSenderAddress: normalizeOptionalEmailAddress(
      input.emailSenderAddress,
      'Email sender address',
    ),
    emailSmtpHost: normalizeSmtpHost(input.emailSmtpHost),
    emailSmtpPort: normalizeSmtpPort(input.emailSmtpPort),
    emailSmtpSecurity: normalizeEmailSmtpSecurity(input.emailSmtpSecurity),
    emailUsername: normalizeSingleLineText(input.emailUsername, 'Email username', 320),
    emailTestRecipientOverride: normalizeOptionalEmailAddress(
      input.emailTestRecipientOverride,
      'Email test recipient override',
    ),
  };
}

function normalizeEmailDeliveryProvider(value: string): EmailDeliveryProvider {
  const normalizedValue = value.trim();

  if (normalizedValue === '') {
    return 'dryRun';
  }

  if (normalizedValue !== 'dryRun' && normalizedValue !== 'smtp') {
    throw new CompanySettingsValidationError(
      'Email delivery provider must be dryRun or smtp.',
    );
  }

  return normalizedValue;
}

function normalizeEmailSmtpSecurity(value: string): EmailSmtpSecurity {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === '') {
    return 'starttls';
  }

  if (normalizedValue !== 'tls' && normalizedValue !== 'starttls') {
    throw new CompanySettingsValidationError('Email SMTP security must be tls or starttls.');
  }

  return normalizedValue;
}

function normalizeSmtpHost(value: string): string {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === '') {
    return '';
  }

  if (
    normalizedValue.length > 253 ||
    /[\s/\\:@]/.test(normalizedValue) ||
    !/^[a-z0-9.-]+$/.test(normalizedValue)
  ) {
    throw new CompanySettingsValidationError('Email SMTP host is invalid.');
  }

  return normalizedValue;
}

function normalizeSmtpPort(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new CompanySettingsValidationError('Email SMTP port must be a whole number.');
  }

  if (value < 1 || value > 65_535) {
    throw new CompanySettingsValidationError('Email SMTP port must be between 1 and 65535.');
  }

  return value;
}

function normalizeOptionalEmailAddress(value: string, fieldName: string): string {
  const normalizedValue = normalizeSingleLineText(value, fieldName, 320);

  if (normalizedValue === '') {
    return '';
  }

  if (
    normalizedValue.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)
  ) {
    throw new CompanySettingsValidationError(`${fieldName} is invalid.`);
  }

  return normalizedValue;
}

function normalizeSingleLineText(value: string, fieldName: string, maxLength: number): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    throw new CompanySettingsValidationError(
      `${fieldName} must be ${maxLength} characters or less.`,
    );
  }

  if (/[\r\n]/.test(normalizedValue)) {
    throw new CompanySettingsValidationError(`${fieldName} must be a single line.`);
  }

  return normalizedValue;
}
