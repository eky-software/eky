import type { CompanySettings, Customer } from '@eky/api-client';

import { applyCustomerBillingRecipientDefault } from './invoiceBillingRecipientDefaults.js';
import { resolveHourlyRateAutofillConfig } from './invoiceHourlyRatePricing.js';
import { refreshAutoAppliedHourlyRates } from './invoiceRowFormState.js';
import type { NewInvoiceFormState } from './newInvoiceFormState.js';

export function applyInvoiceCustomerSelection(
  form: NewInvoiceFormState,
  customers: readonly Customer[],
  companySettings: CompanySettings | null,
  customerId: string,
  applyPriceInputModeDefault: boolean,
): NewInvoiceFormState {
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const formWithRecipient = applyCustomerBillingRecipientDefault(
    form,
    customers,
    customerId,
  );

  return {
    ...formWithRecipient,
    priceInputMode: applyPriceInputModeDefault
      ? selectedCustomer?.customerType === 'privatePerson'
        ? 'gross'
        : 'net'
      : form.priceInputMode,
    lines: refreshAutoAppliedHourlyRates(
      formWithRecipient.lines,
      resolveHourlyRateAutofillConfig(
        customerId,
        customers,
        companySettings,
      ),
    ),
  };
}
