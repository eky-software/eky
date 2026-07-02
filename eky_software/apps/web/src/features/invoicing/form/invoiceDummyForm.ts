import type {
  CompanySettings,
  Customer,
  InvoicePaymentSettingsView,
} from '@eky/api-client';

import { centsToEuroInput } from '../../../shared/money/hourlyRateInput.js';
import { applyCustomerBillingRecipientDefault } from './invoiceBillingRecipientDefaults.js';
import { applyInvoicePaymentDefaults } from './invoicePaymentDefaults.js';
import {
  createInitialNewInvoiceForm,
  type NewInvoiceFormState,
} from './newInvoiceFormState.js';

export function createDummyInvoiceForm(
  customers: Customer[],
  companySettings: CompanySettings | null,
  paymentSettings: InvoicePaymentSettingsView | null = null,
  initialDate = new Date(),
): NewInvoiceFormState {
  const customer = findPreferredDummyCustomer(customers);
  const hourlyRateCents = resolveDummyHourlyRateCents(
    customer,
    companySettings,
  );
  const initialForm =
    paymentSettings === null
      ? createInitialNewInvoiceForm(initialDate)
      : applyInvoicePaymentDefaults(
          createInitialNewInvoiceForm(initialDate),
          paymentSettings,
        );
  const formWithCustomer =
    customer === null
      ? initialForm
      : applyCustomerBillingRecipientDefault(
          initialForm,
          customers,
          customer.id,
        );

  return {
    ...formWithCustomer,
    deliveryAddressText: 'Testikohde',
    note: 'Testilasku sovelluksen kokeilua varten.',
    orderNumber: 'TESTI-001',
    priceInputMode: customer?.customerType === 'privatePerson' ? 'gross' : 'net',
    subject: 'Testilasku',
    lines: [
      {
        id: 'invoice-row-1',
        description: companySettings?.hourlyRateShortcut.trim() || 'työ',
        discountType: 'none',
        discountValue: '',
        hourlyRateAutofillState: 'blocked',
        quantity: '1,00',
        unit: 'h',
        unitPrice: centsToEuroInput(hourlyRateCents),
        vatRateBasisPoints: 2550,
      },
    ],
  };
}

function findPreferredDummyCustomer(customers: Customer[]): Customer | null {
  return (
    customers.find((customer) => customer.status === 'active') ??
    customers[0] ??
    null
  );
}

function resolveDummyHourlyRateCents(
  customer: Customer | null,
  companySettings: CompanySettings | null,
): number {
  return (
    customer?.hourlyRateOverrideCents ??
    companySettings?.defaultHourlyRateCents ??
    6500
  );
}
