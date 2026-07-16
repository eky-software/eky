import type { CompanySettings, UpdateCompanySettingsRequest } from '@eky/api-client';

import {
  centsToEuroInput,
  euroInputToCents,
} from '../../shared/money/hourlyRateInput.js';

export interface CompanySettingsForm {
  businessId: string;
  city: string;
  companyName: string;
  vatNumber: string;
  defaultHourlyRateEuro: string;
  hourlyRateShortcut: string;
  email: string;
  phone: string;
  website: string;
  emailDeliveryProvider: 'dryRun' | 'dnaSmtp';
  emailSenderName: string;
  emailSenderAddress: string;
  emailUsername: string;
  emailTestRecipientOverride: string;
  emailSecretConfigured: boolean;
  iban: string;
  bic: string;
  bankName: string;
  postalCode: string;
  streetAddress: string;
}

export const initialCompanySettingsForm: CompanySettingsForm = {
  businessId: '',
  city: '',
  companyName: '',
  vatNumber: '',
  defaultHourlyRateEuro: '',
  hourlyRateShortcut: '',
  email: '',
  phone: '',
  website: '',
  emailDeliveryProvider: 'dryRun',
  emailSenderName: '',
  emailSenderAddress: '',
  emailUsername: '',
  emailTestRecipientOverride: '',
  emailSecretConfigured: false,
  iban: '',
  bic: '',
  bankName: '',
  postalCode: '',
  streetAddress: '',
};

export function toCompanySettingsForm(settings: CompanySettings): CompanySettingsForm {
  return {
    businessId: settings.businessId,
    city: settings.city,
    companyName: settings.companyName,
    vatNumber: settings.vatNumber,
    defaultHourlyRateEuro: centsToEuroInput(settings.defaultHourlyRateCents),
    hourlyRateShortcut: settings.hourlyRateShortcut,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    emailDeliveryProvider: settings.emailDeliveryProvider,
    emailSenderName: settings.emailSenderName,
    emailSenderAddress: settings.emailSenderAddress,
    emailUsername: settings.emailUsername,
    emailTestRecipientOverride: settings.emailTestRecipientOverride,
    emailSecretConfigured: settings.emailSecretConfigured,
    iban: formatCompanyIbanInput(settings.iban),
    bic: settings.bic,
    bankName: settings.bankName,
    postalCode: settings.postalCode,
    streetAddress: settings.streetAddress,
  };
}

export function toUpdateCompanySettingsRequest(
  form: CompanySettingsForm,
): UpdateCompanySettingsRequest {
  return {
    businessId: form.businessId,
    city: form.city,
    companyName: form.companyName,
    vatNumber: normalizeCompanyVatNumberInput(form.vatNumber),
    defaultHourlyRateCents: euroInputToCents(form.defaultHourlyRateEuro),
    hourlyRateShortcut: form.hourlyRateShortcut,
    email: form.email,
    phone: form.phone,
    website: form.website.trim(),
    emailDeliveryProvider: form.emailDeliveryProvider,
    emailSenderName: form.emailSenderName.trim(),
    emailSenderAddress: normalizeCompanyEmailAddressInput(
      form.emailSenderAddress,
      'Invalid company email sender address.',
    ),
    emailUsername: form.emailUsername.trim(),
    emailTestRecipientOverride: normalizeCompanyEmailAddressInput(
      form.emailTestRecipientOverride,
      'Invalid company email test recipient.',
    ),
    iban: normalizeCompanyIbanInput(form.iban),
    bic: normalizeCompanyBicInput(form.bic),
    bankName: normalizeCompanyBankNameInput(form.bankName),
    postalCode: form.postalCode,
    streetAddress: form.streetAddress,
  };
}

export { euroInputToCents } from '../../shared/money/hourlyRateInput.js';

export function normalizeCompanyIbanInput(value: string): string {
  const normalizedValue = value.replace(/\s+/g, '').toUpperCase();

  if (normalizedValue === '') {
    return '';
  }

  if (
    normalizedValue.length < 15 ||
    normalizedValue.length > 34 ||
    !/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalizedValue)
  ) {
    throw new Error('Invalid company IBAN.');
  }

  return normalizedValue;
}

export function formatCompanyIbanInput(value: string): string {
  return value
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

export function normalizeCompanyBicInput(value: string): string {
  const normalizedValue = value.trim().toUpperCase();

  if (normalizedValue === '') {
    return '';
  }

  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizedValue)) {
    throw new Error('Invalid company BIC.');
  }

  return normalizedValue;
}

export function normalizeCompanyBankNameInput(value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length > 200) {
    throw new Error('Invalid company bank name.');
  }

  return normalizedValue;
}

export function normalizeCompanyVatNumberInput(value: string): string {
  const normalizedValue = value.trim().toUpperCase();

  if (normalizedValue === '') {
    return '';
  }

  if (!/^FI\d{8}$/.test(normalizedValue)) {
    throw new Error('Invalid company VAT number.');
  }

  return normalizedValue;
}

export function normalizeCompanyEmailAddressInput(
  value: string,
  errorMessage: string,
): string {
  const normalizedValue = value.trim();

  if (normalizedValue === '') {
    return '';
  }

  if (
    normalizedValue.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)
  ) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}
