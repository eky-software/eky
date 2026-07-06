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

export interface UpdateCompanySettingsRequest {
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
}

export interface CompanySettingsApi {
  getCompanySettings(): Promise<CompanySettings>;
  updateCompanySettings(
    input: UpdateCompanySettingsRequest,
  ): Promise<CompanySettings>;
}
