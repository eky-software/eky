export interface CompanySettings {
  id: string;
  companyId: string;
  companyName: string;
  businessId: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  defaultHourlyRateCents: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCompanySettingsRequest {
  companyName: string;
  businessId: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  defaultHourlyRateCents: number | null;
}

export interface CompanySettingsApi {
  getCompanySettings(): Promise<CompanySettings>;
  updateCompanySettings(
    input: UpdateCompanySettingsRequest,
  ): Promise<CompanySettings>;
}
