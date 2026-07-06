import { randomUUID } from 'node:crypto';

import {
  createCompanySettingsRecord,
  type CompanySettings,
} from '../domain/companySettings.js';
import {
  normalizeCompanySettingsField,
  normalizeCompanyVatNumber,
  normalizeHourlyRateShortcut,
  parseDefaultHourlyRateCents,
} from '../domain/companySettingsRules.js';
import { normalizeCompanyBankDetails } from '../domain/companyBankDetails.js';
import type { CompanySettingsRepository } from '../ports/companySettingsRepository.js';

export interface UpdateCompanySettingsInput {
  businessId: string;
  city: string;
  companyId: string;
  companyName: string;
  vatNumber: string;
  defaultHourlyRateCents: unknown;
  hourlyRateShortcut: string;
  iban: string;
  bic: string;
  bankName: string;
  email: string;
  phone: string;
  website: string;
  postalCode: string;
  streetAddress: string;
}

export async function updateCompanySettings(
  input: UpdateCompanySettingsInput,
  companySettingsRepository: CompanySettingsRepository,
): Promise<CompanySettings> {
  const now = new Date().toISOString();
  const bankDetails = normalizeCompanyBankDetails({
    iban: input.iban,
    bic: input.bic,
    bankName: input.bankName,
  });
  const settings = createCompanySettingsRecord({
    businessId: normalizeCompanySettingsField(input.businessId, 'Company business id'),
    bankName: bankDetails.bankName,
    bic: bankDetails.bic,
    city: normalizeCompanySettingsField(input.city, 'Company city'),
    companyId: input.companyId,
    companyName: normalizeCompanySettingsField(input.companyName, 'Company name'),
    vatNumber: normalizeCompanyVatNumber(input.vatNumber),
    defaultHourlyRateCents: parseDefaultHourlyRateCents(input.defaultHourlyRateCents),
    hourlyRateShortcut: normalizeHourlyRateShortcut(input.hourlyRateShortcut),
    iban: bankDetails.iban,
    email: normalizeCompanySettingsField(input.email, 'Company email'),
    website: normalizeCompanySettingsField(input.website, 'Company website'),
    id: randomUUID(),
    now,
    phone: normalizeCompanySettingsField(input.phone, 'Company phone'),
    postalCode: normalizeCompanySettingsField(input.postalCode, 'Company postal code'),
    streetAddress: normalizeCompanySettingsField(input.streetAddress, 'Company street address'),
  });

  return companySettingsRepository.upsertCompanySettings(settings);
}
