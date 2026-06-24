import { EkyApiError, isRecord, requestJson } from '../http.js';
import type {
  CompanySettings,
  CompanySettingsApi,
} from './companySettingsTypes.js';

export function createCompanySettingsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): CompanySettingsApi {
  return {
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

function parseCompanySettings(value: unknown): CompanySettings {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.companyId !== 'string' ||
    typeof value.companyName !== 'string' ||
    typeof value.businessId !== 'string' ||
    typeof value.streetAddress !== 'string' ||
    typeof value.postalCode !== 'string' ||
    typeof value.city !== 'string' ||
    typeof value.email !== 'string' ||
    typeof value.phone !== 'string' ||
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
    streetAddress: value.streetAddress,
    postalCode: value.postalCode,
    city: value.city,
    email: value.email,
    phone: value.phone,
    defaultHourlyRateCents: value.defaultHourlyRateCents,
    hourlyRateShortcut: value.hourlyRateShortcut,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}
