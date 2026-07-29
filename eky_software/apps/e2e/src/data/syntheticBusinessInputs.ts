export function createSyntheticCustomerInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    businessId: '1234567-8',
    city: 'Testikaupunki',
    comment: 'Synthetic E2E customer',
    customerNumber: 'E2E-1001',
    customerNumberMode: 'manual',
    customerType: 'company',
    email: 'customer@example.invalid',
    hourlyRateOverrideCents: 6_500,
    managedByCustomerId: '',
    name: 'Synthetic Customer Oy',
    phone: '040 000 0000',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Testikatu 1',
    ...overrides,
  };
}

export function createSyntheticCompanySettingsInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    bankName: 'Synthetic Bank',
    bic: 'NDEAFIHH',
    businessId: '7654321-0',
    city: 'Testikaupunki',
    companyName: 'Synthetic Builder Oy',
    defaultHourlyRateCents: 7_500,
    email: 'office@example.invalid',
    emailDeliveryProvider: 'dryRun',
    emailSenderAddress: 'billing@example.invalid',
    emailSenderName: 'Synthetic Builder Oy',
    emailTestRecipientOverride: 'delivery-test@example.invalid',
    emailUsername: 'billing@example.invalid',
    hourlyRateShortcut: 'työ',
    iban: 'FI2112345600000785',
    phone: '040 111 1111',
    postalCode: '00100',
    streetAddress: 'Rakentajantie 1',
    vatNumber: 'FI76543210',
    website: 'https://example.invalid',
    ...overrides,
  };
}

export function createSyntheticInvoiceDraftInput(
  customerId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    billingRecipientCustomerId: '',
    customerId,
    deliveryAddressText: 'Synthetic Site 1',
    dueDate: '2026-08-12',
    invoiceDate: '2026-07-29',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        code: 'WORK',
        description: 'Synthetic installation work',
        discount: { type: 'none' },
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 6_500,
        vatRateBasisPoints: 2_550,
      },
    ],
    note: 'Synthetic E2E invoice draft',
    orderNumber: 'E2E-ORDER-1',
    paymentTermDays: 14,
    performancePeriod: { type: 'invoiceDate' },
    priceInputMode: 'net',
    reminderPeriodDays: 14,
    subject: 'Synthetic E2E invoice',
    taxTreatment: 'normalVat',
    ...overrides,
  };
}
