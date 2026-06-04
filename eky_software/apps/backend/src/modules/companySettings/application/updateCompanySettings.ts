import { randomUUID } from 'node:crypto';

import {
  createCompanySettingsRecord,
  type CompanySettings,
} from '../domain/companySettings.js';
import {
  normalizeCompanySettingsField,
  parseDefaultHourlyRateCents,
} from '../domain/companySettingsRules.js';
import type { CompanySettingsRepository } from '../ports/companySettingsRepository.js';

export interface UpdateCompanySettingsInput {
  businessId: string;
  city: string;
  companyId: string;
  companyName: string;
  defaultHourlyRateCents: unknown;
  email: string;
  phone: string;
  postalCode: string;
  streetAddress: string;
}

export async function updateCompanySettings(
  input: UpdateCompanySettingsInput,
  companySettingsRepository: CompanySettingsRepository,
): Promise<CompanySettings> {
  const now = new Date().toISOString();
  const settings = createCompanySettingsRecord({
    businessId: normalizeCompanySettingsField(input.businessId, 'Company business id'),
    city: normalizeCompanySettingsField(input.city, 'Company city'),
    companyId: input.companyId,
    companyName: normalizeCompanySettingsField(input.companyName, 'Company name'),
    defaultHourlyRateCents: parseDefaultHourlyRateCents(input.defaultHourlyRateCents),
    email: normalizeCompanySettingsField(input.email, 'Company email'),
    id: randomUUID(),
    now,
    phone: normalizeCompanySettingsField(input.phone, 'Company phone'),
    postalCode: normalizeCompanySettingsField(input.postalCode, 'Company postal code'),
    streetAddress: normalizeCompanySettingsField(input.streetAddress, 'Company street address'),
  });

  return companySettingsRepository.upsertCompanySettings(settings);
}
