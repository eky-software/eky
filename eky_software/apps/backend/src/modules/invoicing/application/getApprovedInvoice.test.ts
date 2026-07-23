import { describe, expect, it } from 'vitest';

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

  async listApprovedInvoiceSummaries() {
    return { invoices: [], totalCount: 0 };
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
    ).resolves.toEqual(invoice);
    expect(reader.input).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('keeps a cancelled invoice available as a read-only view', async () => {
    const invoice = createApprovedInvoiceView({
      cancelledAt: '2026-07-23T10:00:00.000Z',
      cancelledBy: 'user-1',
      cancellationReason: 'Duplicate invoice',
      status: 'cancelled',
    });

    await expect(
      getApprovedInvoice(
        { companyId: 'dev-company', invoiceId: 'invoice-1' },
        new FakeApprovedInvoiceReader(invoice),
      ),
    ).resolves.toEqual(invoice);
  });

  it('normalizes approved invoice VAT breakdown from VAT-rate totals', async () => {
    const invoice = {
      ...createApprovedInvoiceView(),
      lines: [
        createApprovedInvoiceLine('line-1', 1, 5_500),
        ...Array.from({ length: 25 }, (_, index) =>
          createApprovedInvoiceLine(`line-small-${index + 1}`, index + 2, 100),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          createApprovedInvoiceLine(`line-medium-${index + 1}`, index + 27, 1_100),
        ),
      ],
      totals: {
        netTotalCents: 12_400,
        vatTotalCents: 3_162,
        grossTotalCents: 15_562,
        vatBreakdown: [
          {
            vatRateBasisPoints: 2550,
            netCents: 12_400,
            vatCents: 3_177,
            grossCents: 15_577,
          },
        ],
      },
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 12_400,
          vatCents: 3_177,
          grossCents: 15_577,
        },
      ],
    };
    const reader = new FakeApprovedInvoiceReader(invoice);

    await expect(
      getApprovedInvoice(
        { companyId: 'dev-company', invoiceId: 'invoice-1' },
        reader,
      ),
    ).resolves.toMatchObject({
      totals: {
        netTotalCents: 12_400,
        vatTotalCents: 3_162,
        grossTotalCents: 15_562,
        vatBreakdown: [
          {
            vatRateBasisPoints: 2550,
            netCents: 12_400,
            vatCents: 3_162,
            grossCents: 15_562,
          },
        ],
      },
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 12_400,
          vatCents: 3_162,
          grossCents: 15_562,
        },
      ],
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

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'dev-company',
    sourceDraftId: 'draft-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
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
    refundIbanSnapshot: '',
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
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    ...overrides,
  };
}

function createApprovedInvoiceLine(
  id: string,
  lineOrder: number,
  netCents: number,
): ApprovedInvoiceView['lines'][number] {
  const vatCents = Math.round((netCents * 2550) / 10_000);

  return {
    id,
    sourceInvoiceLineId: null,
    lineOrder,
    code: '',
    description: 'Test line',
    quantityHundredths: 100,
    unit: 'kpl',
    unitPriceCents: netCents,
    vatRateBasisPoints: 2550,
    discount: { type: 'none' },
    baseCents: netCents,
    discountCents: 0,
    netCents,
    vatCents,
    grossCents: netCents + vatCents,
  };
}
