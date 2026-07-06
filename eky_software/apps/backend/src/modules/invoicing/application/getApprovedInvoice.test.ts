import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { getApprovedInvoice } from './getApprovedInvoice.js';

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  input:
    | {
        companyId: string;
        invoiceId: string;
      }
    | undefined;

  constructor(private readonly invoice: ApprovedInvoiceView | undefined) {}

  async getApprovedInvoiceById(
    companyId: string,
    invoiceId: string,
  ): Promise<ApprovedInvoiceView | undefined> {
    this.input = { companyId, invoiceId };
    return this.invoice;
  }

  async listApprovedInvoiceSummaries(): Promise<ApprovedInvoiceSummary[]> {
    return [];
  }
}

describe('getApprovedInvoice', () => {
  it('returns an approved invoice from the company scoped reader', async () => {
    const invoice = createApprovedInvoiceView();
    const reader = new FakeApprovedInvoiceReader(invoice);

    await expect(
      getApprovedInvoice(
        { companyId: 'dev-company', invoiceId: 'invoice-1' },
        reader,
      ),
    ).resolves.toBe(invoice);
    expect(reader.input).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('throws not found when the reader cannot find an approved invoice', async () => {
    const reader = new FakeApprovedInvoiceReader(undefined);

    await expect(
      getApprovedInvoice(
        { companyId: 'dev-company', invoiceId: 'missing-invoice' },
        reader,
      ),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);
  });

  it('validates identifiers before reading', async () => {
    const reader = new FakeApprovedInvoiceReader(createApprovedInvoiceView());

    await expect(
      getApprovedInvoice({ companyId: 'dev-company', invoiceId: '' }, reader),
    ).rejects.toThrow('Invoice id is required.');
    expect(reader.input).toBeUndefined();
  });
});

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'dev-company',
    sourceDraftId: 'draft-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2026',
    sequenceNumber: 1,
    numberingMode: 'calendarYearSequence',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    customerBusinessIdSnapshot: '1234567-8',
    customerTypeSnapshot: 'company',
    customerEmailSnapshot: 'customer@example.fi',
    customerPhoneSnapshot: '040 111 2222',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerPostalCodeSnapshot: '00100',
    customerCitySnapshot: 'Helsinki',
    companyNameSnapshot: 'Example Builder Oy',
    companyBusinessIdSnapshot: '7654321-0',
    companyVatNumberSnapshot: 'FI76543210',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyPostalCodeSnapshot: '33100',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyPhoneSnapshot: '03 123 4567',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyBicSnapshot: 'NDEAFIHH',
    companyBankNameSnapshot: 'Example Bank',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientCitySnapshot: 'Espoo',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Invoice note',
    deliveryAddressText: 'Worksite Street 4',
    lines: [],
    totals: {
      netTotalCents: 0,
      vatTotalCents: 0,
      grossTotalCents: 0,
      vatBreakdown: [],
    },
    vatBreakdown: [],
    createdAt: '2026-06-13T10:00:00.000Z',
    approvedAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  };
}
