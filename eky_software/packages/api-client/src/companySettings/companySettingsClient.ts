import { EkyApiError, isRecord, requestJson } from '../http.js';
import type {
  CompanyEmailSecretStatus,
  CompanySettings,
  CompanySettingsApi,
} from './companySettingsTypes.js';

export function createCompanySettingsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): CompanySettingsApi {
  return {
    async getCompanyEmailSecretStatus(): Promise<CompanyEmailSecretStatus> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/company-settings/email-secret',
      );

      return parseCompanyEmailSecretStatusResponse(responseBody);
    },

    async getCompanySettings(): Promise<CompanySettings> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/company-settings',
      );

      if (!isRecord(responseBody)) {
        throw new EkyApiError('Invalid company settings response.', {
          responseBody,
        });
      }

      return parseCompanySettings(responseBody.companySettings);
    },

    async removeCompanyEmailSecret(): Promise<CompanyEmailSecretStatus> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/company-settings/email-secret',
        { method: 'DELETE' },
      );

      return parseCompanyEmailSecretStatusResponse(responseBody);
    },

    async setCompanyEmailSecret(input): Promise<CompanyEmailSecretStatus> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/company-settings/email-secret',
        {
          body: JSON.stringify({ secret: input.secret }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'PUT',
        },
      );

      return parseCompanyEmailSecretStatusResponse(responseBody);
    },

    async updateCompanySettings(input): Promise<CompanySettings> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/company-settings',
        {
          body: JSON.stringify(input),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'PUT',
        },
      );

      if (!isRecord(responseBody)) {
        throw new EkyApiError('Invalid company settings response.', {
          responseBody,
        });
      }

      return parseCompanySettings(responseBody.companySettings);
    },
  };
}

function parseCompanyEmailSecretStatusResponse(
  value: unknown,
): CompanyEmailSecretStatus {
  if (!isRecord(value)) {
    throw new EkyApiError('Invalid company email secret response.', {
      responseBody: value,
    });
  }

  const status = value.emailSecretStatus;

  if (!isRecord(status) || typeof status.configured !== 'boolean') {
    throw new EkyApiError('Invalid company email secret response.', {
      responseBody: status,
    });
  }

  return { configured: status.configured };
}

function parseCompanySettings(value: unknown): CompanySettings {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.companyId !== 'string' ||
    typeof value.companyName !== 'string' ||
    typeof value.businessId !== 'string' ||
    typeof value.vatNumber !== 'string' ||
    typeof value.streetAddress !== 'string' ||
    typeof value.postalCode !== 'string' ||
    typeof value.city !== 'string' ||
    typeof value.email !== 'string' ||
    typeof value.phone !== 'string' ||
    typeof value.website !== 'string' ||
    !isEmailDeliveryProvider(value.emailDeliveryProvider) ||
    typeof value.emailSenderName !== 'string' ||
    typeof value.emailSenderAddress !== 'string' ||
    typeof value.emailSmtpHost !== 'string' ||
    !isNullableNumber(value.emailSmtpPort) ||
    !isEmailSmtpSecurity(value.emailSmtpSecurity) ||
    typeof value.emailUsername !== 'string' ||
    typeof value.emailTestRecipientOverride !== 'string' ||
    typeof value.emailSecretConfigured !== 'boolean' ||
    typeof value.iban !== 'string' ||
    typeof value.bic !== 'string' ||
    typeof value.bankName !== 'string' ||
    !isNullableNumber(value.defaultHourlyRateCents) ||
    typeof value.hourlyRateShortcut !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new EkyApiError('Invalid company settings response.', {
      responseBody: value,
    });
  }

  return {
    id: value.id,
    companyId: value.companyId,
    companyName: value.companyName,
    businessId: value.businessId,
    vatNumber: value.vatNumber,
    streetAddress: value.streetAddress,
    postalCode: value.postalCode,
    city: value.city,
    email: value.email,
    phone: value.phone,
    website: value.website,
    emailDeliveryProvider: value.emailDeliveryProvider,
    emailSenderName: value.emailSenderName,
    emailSenderAddress: value.emailSenderAddress,
    emailSmtpHost: value.emailSmtpHost,
    emailSmtpPort: value.emailSmtpPort,
    emailSmtpSecurity: value.emailSmtpSecurity,
    emailUsername: value.emailUsername,
    emailTestRecipientOverride: value.emailTestRecipientOverride,
    emailSecretConfigured: value.emailSecretConfigured,
    iban: value.iban,
    bic: value.bic,
    bankName: value.bankName,
    defaultHourlyRateCents: value.defaultHourlyRateCents,
    hourlyRateShortcut: value.hourlyRateShortcut,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isEmailDeliveryProvider(value: unknown): value is 'dryRun' | 'dnaSmtp' {
  return value === 'dryRun' || value === 'dnaSmtp';
}

function isEmailSmtpSecurity(value: unknown): value is 'tls' {
  return value === 'tls';
}
