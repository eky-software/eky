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
  emailDeliveryProvider: 'dryRun' | 'smtp';
  emailSenderName: string;
  emailSenderAddress: string;
  emailSmtpHost: string;
  emailSmtpPort: number | null;
  emailSmtpSecurity: 'tls' | 'starttls';
  emailUsername: string;
  emailTestRecipientOverride: string;
  emailSecretConfigured: boolean;
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
  emailDeliveryProvider: 'dryRun' | 'smtp';
  emailSenderName: string;
  emailSenderAddress: string;
  emailSmtpHost: string;
  emailSmtpPort: number | null;
  emailSmtpSecurity: 'tls' | 'starttls';
  emailUsername: string;
  emailTestRecipientOverride: string;
  iban: string;
  bic: string;
  bankName: string;
  defaultHourlyRateCents: number | null;
  hourlyRateShortcut: string;
}

export interface CompanyEmailSecretStatus {
  configured: boolean;
}

export interface SetCompanyEmailSecretRequest {
  secret: string;
}

export interface CompanySettingsApi {
  getCompanyEmailSecretStatus(): Promise<CompanyEmailSecretStatus>;
  getCompanySettings(): Promise<CompanySettings>;
  removeCompanyEmailSecret(): Promise<CompanyEmailSecretStatus>;
  setCompanyEmailSecret(
    input: SetCompanyEmailSecretRequest,
  ): Promise<CompanyEmailSecretStatus>;
  updateCompanySettings(
    input: UpdateCompanySettingsRequest,
  ): Promise<CompanySettings>;
}
