import type { Customer, InvoiceDraftSummary } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { getInvoiceDraftCustomerDisplayName } from './invoiceDraftCustomerDisplay.js';
import { uiText } from '../../i18n/fi.js';

describe('getInvoiceDraftCustomerDisplayName', () => {
  it('shows customer number and name instead of technical ids', () => {
    expect(
      getInvoiceDraftCustomerDisplayName(createDraftSummary(), [
        createCustomer(),
      ]),
    ).toBe('1001 – Esimerkki Asiakas Oy');
  });

  it('uses a safe fallback when the customer is missing', () => {
    expect(
      getInvoiceDraftCustomerDisplayName(createDraftSummary(), []),
    ).toBe(uiText.invoicing.customerNotFound);
  });
});

function createDraftSummary(): InvoiceDraftSummary {
  return {
    customerId: 'customer-1',
    dueDate: '2026-06-30',
    grossTotalCents: 12550,
    id: 'draft-1',
    invoiceDate: '2026-06-16',
    netTotalCents: 10000,
    paymentTermDays: 14,
    priceInputMode: 'net',
    status: 'draft',
    subject: '',
    updatedAt: '2026-06-16T12:00:00.000Z',
    vatTotalCents: 2550,
  };
}

function createCustomer(): Customer {
  return {
    businessId: '1234567-8',
    city: 'Helsinki',
    comment: '',
    companyId: 'dev-company',
    createdAt: '2026-06-16T12:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'testi@example.fi',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Asiakas Oy',
    phone: '040 123 4567',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Testikatu 1',
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}
