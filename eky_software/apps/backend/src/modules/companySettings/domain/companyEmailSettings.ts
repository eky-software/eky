import { CompanySettingsValidationError } from './companySettingsRules.js';

export type EmailDeliveryProvider = 'dryRun' | 'dnaSmtp';
export type EmailSmtpSecurity = 'tls';

export const dnaSmtpCompatibilityProfile = Object.freeze({
  host: 'smtp.dnamail.fi',
  port: 465,
  security: 'tls' as const,
});

export interface CompanyEmailSettingsInput {
  emailDeliveryProvider: string;
  emailSenderName: string;
  emailSenderAddress: string;
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
  const emailDeliveryProvider = normalizeEmailDeliveryProvider(
    input.emailDeliveryProvider,
  );
  const emailSenderAddress = normalizeOptionalEmailAddress(
    input.emailSenderAddress,
    'Email sender address',
  );
  const emailUsername = normalizeOptionalEmailAddress(
    input.emailUsername,
    'Email username',
  );

  if (
    emailDeliveryProvider === 'dnaSmtp' &&
    (emailSenderAddress === '' ||
      emailUsername === '' ||
      emailSenderAddress.toLowerCase() !== emailUsername.toLowerCase())
  ) {
    throw new CompanySettingsValidationError(
      'DNA SMTP sender address and username must be the same email address.',
    );
  }

  return {
    emailDeliveryProvider,
    emailSenderName: normalizeSingleLineText(input.emailSenderName, 'Email sender name', 200),
    emailSenderAddress,
    emailSmtpHost:
      emailDeliveryProvider === 'dnaSmtp'
        ? dnaSmtpCompatibilityProfile.host
        : '',
    emailSmtpPort:
      emailDeliveryProvider === 'dnaSmtp'
        ? dnaSmtpCompatibilityProfile.port
        : null,
    emailSmtpSecurity: dnaSmtpCompatibilityProfile.security,
    emailUsername,
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

  if (normalizedValue !== 'dryRun' && normalizedValue !== 'dnaSmtp') {
    throw new CompanySettingsValidationError(
      'Email delivery provider must be dryRun or dnaSmtp.',
    );
  }

  return normalizedValue;
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
