export interface CompanySettings {
  id: string;
  companyId: string;
  companyName: string;
  businessId: string;
  vatNumber: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  website: string;
  iban: string;
  bic: string;
  bankName: string;
  defaultHourlyRateCents: number | null;
  hourlyRateShortcut: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCompanySettingsDomainInput {
  businessId: string;
  city: string;
  companyId: string;
  companyName: string;
  vatNumber: string;
  defaultHourlyRateCents: number | null;
  hourlyRateShortcut: string;
  iban: string;
  email: string;
  website: string;
  id: string;
  bankName: string;
  bic: string;
  now: string;
  phone: string;
  postalCode: string;
  streetAddress: string;
}

export function createCompanySettingsRecord(
  input: CreateCompanySettingsDomainInput,
): CompanySettings {
  return {
    id: input.id,
    companyId: input.companyId,
    companyName: input.companyName,
    businessId: input.businessId,
    vatNumber: input.vatNumber,
    streetAddress: input.streetAddress,
    postalCode: input.postalCode,
    city: input.city,
    email: input.email,
    phone: input.phone,
    website: input.website,
    iban: input.iban,
    bic: input.bic,
    bankName: input.bankName,
    defaultHourlyRateCents: input.defaultHourlyRateCents,
    hourlyRateShortcut: input.hourlyRateShortcut,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createEmptyCompanySettings(companyId: string): CompanySettings {
  return {
    id: '',
    companyId,
    companyName: '',
    businessId: '',
    vatNumber: '',
    streetAddress: '',
    postalCode: '',
    city: '',
    email: '',
    phone: '',
    website: '',
    iban: '',
    bic: '',
    bankName: '',
    defaultHourlyRateCents: null,
    hourlyRateShortcut: '',
    createdAt: '',
    updatedAt: '',
  };
}
