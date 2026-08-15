import { describe, expect, it } from 'vitest';

import { findInvoiceIssuanceReadinessIssues } from './invoiceIssuanceReadiness.js';

const completeData = {
  billingRecipientCity: 'Espoo',
  billingRecipientName: 'Billing Recipient Oy',
  billingRecipientPostalCode: '02100',
  billingRecipientStreetAddress: 'Recipient Street 3',
  companyBusinessId: '7654321-0',
  companyCity: 'Tampere',
  companyIban: 'FI2112345600000785',
  companyName: 'Example Builder Oy',
  companyPostalCode: '33100',
  companyStreetAddress: 'Builder Street 2',
  companyVatNumber: 'FI76543210',
  customerCity: 'Helsinki',
  customerName: 'Test Customer Oy',
  customerPostalCode: '00100',
  customerStreetAddress: 'Customer Street 1',
  hasActiveInvoiceNumberingSettings: true,
} as const;

describe('invoice issuance readiness', () => {
  it('accepts complete seller, customer, recipient and payment details', () => {
    expect(findInvoiceIssuanceReadinessIssues(completeData)).toEqual([]);
  });

  it('reports each incomplete issuance boundary without exposing values', () => {
    expect(
      findInvoiceIssuanceReadinessIssues({
        ...completeData,
        billingRecipientName: ' ',
        companyBusinessId: '',
        companyIban: '\t',
        companyPostalCode: '',
        customerStreetAddress: '',
      }),
    ).toEqual([
      'companyBusinessIdMissing',
      'companyAddressMissing',
      'companyIbanMissing',
      'customerAddressMissing',
      'billingRecipientNameMissing',
    ]);
  });
});
