import type { Customer } from '@eky/api-client';

import type { NewInvoiceFormState } from './newInvoiceFormState.js';

export function applyCustomerBillingRecipientDefault(
  form: NewInvoiceFormState,
  customers: readonly Customer[],
  customerId: string,
): NewInvoiceFormState {
  return {
    ...form,
    billingRecipientCustomerId: getSuggestedBillingRecipientCustomerId(
      customerId,
      customers,
    ),
    customerId,
  };
}

export function getSuggestedBillingRecipientCustomerId(
  customerId: string,
  customers: readonly Customer[],
): string {
  const customer = customers.find((item) => item.id === customerId);

  if (
    customer?.customerType !== 'housingCompany' ||
    customer.managedByCustomerId.trim() === ''
  ) {
    return '';
  }

  const propertyManager = customers.find(
    (item) =>
      item.id === customer.managedByCustomerId &&
      item.customerType === 'propertyManager',
  );

  return propertyManager?.id ?? '';
}
