import type { CompanySettings, UpdateCompanySettingsRequest } from '@eky/api-client';

import {
  centsToEuroInput,
  euroInputToCents,
} from '../../shared/money/hourlyRateInput.js';

export interface CompanySettingsForm {
  businessId: string;
  city: string;
  companyName: string;
  defaultHourlyRateEuro: string;
  hourlyRateShortcut: string;
  email: string;
  phone: string;
  postalCode: string;
  streetAddress: string;
}

export const initialCompanySettingsForm: CompanySettingsForm = {
  businessId: '',
  city: '',
  companyName: '',
  defaultHourlyRateEuro: '',
  hourlyRateShortcut: '',
  email: '',
  phone: '',
  postalCode: '',
  streetAddress: '',
};

export function toCompanySettingsForm(settings: CompanySettings): CompanySettingsForm {
  return {
    businessId: settings.businessId,
    city: settings.city,
    companyName: settings.companyName,
    defaultHourlyRateEuro: centsToEuroInput(settings.defaultHourlyRateCents),
    hourlyRateShortcut: settings.hourlyRateShortcut,
    email: settings.email,
    phone: settings.phone,
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
    defaultHourlyRateCents: euroInputToCents(form.defaultHourlyRateEuro),
    hourlyRateShortcut: form.hourlyRateShortcut,
    email: form.email,
    phone: form.phone,
    postalCode: form.postalCode,
    streetAddress: form.streetAddress,
  };
}

export { euroInputToCents } from '../../shared/money/hourlyRateInput.js';
