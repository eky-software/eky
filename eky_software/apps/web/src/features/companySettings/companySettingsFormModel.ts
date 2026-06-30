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
    iban: settings.iban,
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
