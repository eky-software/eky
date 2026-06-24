import type { CompanySettings, Customer } from '@eky/api-client';

import type { HourlyRateAutofillConfig } from './invoiceRowFormState.js';

export function resolveHourlyRateAutofillConfig(
  customerId: string,
  customers: Customer[],
  companySettings: CompanySettings | null,
): HourlyRateAutofillConfig {
  const customer = customers.find((item) => item.id === customerId);

  if (customer === undefined) {
    return {
      hourlyRateCents: null,
      shortcut: companySettings?.hourlyRateShortcut ?? '',
    };
  }

  return {
    hourlyRateCents:
      customer.hourlyRateOverrideCents ??
      companySettings?.defaultHourlyRateCents ??
      null,
    shortcut: companySettings?.hourlyRateShortcut ?? '',
  };
}
