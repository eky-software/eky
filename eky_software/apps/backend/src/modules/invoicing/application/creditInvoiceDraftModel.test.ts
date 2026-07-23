import { describe, expect, it } from 'vitest';

import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import {
  createInitialCreditDraft,
  prepareUpdatedCreditDraft,
  toCreditInvoiceDraftView,
} from './creditInvoiceDraftModel.js';

describe('creditInvoiceDraftModel', () => {
  it('creates a full credit draft from the sent invoice snapshot', () => {
    const source = createSourceInvoice();
    const draft = createInitialCreditDraft(
      source,
      [],
      '2026-07-23T10:00:00.000Z',
    );

    expect(draft).toMatchObject({
      companyId: 'company-1',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      customerId: 'customer-1',
      billingRecipientCustomerId: 'billing-1',
      invoiceDate: '2026-07-23',
      dueDate: '2026-07-23',
      paymentTermDays: 0,
      reminderPeriodDays: 0,
      latePaymentInterestBasisPoints: 0,
      priceInputMode: 'net',
      orderNumber: 'ORDER-1',
      deliveryAddressText: 'Worksite 4',
      totals: {
        netTotalCents: 20_000,
        vatTotalCents: 5_100,
        grossTotalCents: 25_100,
      },
    });
    expect(draft.subject).toContain('20260001');
    expect(draft.note).toContain('Hyvittää laskua 20260001.');
    expect(draft.lines).toEqual([
      expect.objectContaining({
        sourceInvoiceLineId: 'line-1',
        quantityHundredths: 200,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2_550,
        discount: { type: 'none' },
        netCents: 20_000,
        vatCents: 5_100,
        grossCents: 25_100,
      }),
    ]);
  });

  it('uses only the quantity and cents remaining after previous credits', () => {
    const draft = createInitialCreditDraft(
      createSourceInvoice(),
      [
        {
          sourceInvoiceLineId: 'line-1',
          quantityHundredths: 50,
          baseCents: 5_000,
          discountCents: 0,
          netCents: 5_000,
          vatCents: 1_275,
          grossCents: 6_275,
        },
      ],
      '2026-07-23T10:00:00.000Z',
    );

    expect(draft.lines[0]).toMatchObject({
      quantityHundredths: 150,
      baseCents: 15_000,
      netCents: 15_000,
      vatCents: 3_825,
      grossCents: 18_825,
    });
  });

  it('rejects creating another credit draft after the invoice is fully credited', () => {
    expect(() =>
      createInitialCreditDraft(
        createSourceInvoice(),
        [
          {
            sourceInvoiceLineId: 'line-1',
            quantityHundredths: 200,
            baseCents: 20_000,
            discountCents: 0,
            netCents: 20_000,
            vatCents: 5_100,
            grossCents: 25_100,
          },
        ],
        '2026-07-23T10:00:00.000Z',
      ),
    ).toThrow(InvoiceCreditError);
  });

  it('rebuilds immutable values from the source snapshot during update', () => {
    const source = createSourceInvoice();
    const existing = createInitialCreditDraft(
      source,
      [],
      '2026-07-23T10:00:00.000Z',
    );
    const updated = prepareUpdatedCreditDraft(existing, source, [], {
      subject: 'Partial correction',
      note: 'Correct one hour.',
      lines: [
        {
          sourceInvoiceLineId: 'line-1',
          description: 'Corrected work description',
          quantityHundredths: 100,
        },
      ],
      updatedAt: '2026-07-23T11:00:00.000Z',
    });

    expect(updated).toMatchObject({
      customerId: source.customerId,
      billingRecipientCustomerId: source.billingRecipientCustomerId,
      invoiceKind: 'credit',
      creditedInvoiceId: source.id,
      priceInputMode: source.priceInputMode,
      subject: 'Partial correction',
      note: 'Correct one hour.',
    });
    expect(updated.lines[0]).toMatchObject({
      sourceInvoiceLineId: 'line-1',
      description: 'Corrected work description',
      quantityHundredths: 100,
      unit: 'h',
      unitPriceCents: 10_000,
      vatRateBasisPoints: 2_550,
      discount: { type: 'none' },
      grossCents: 12_550,
    });
  });

  it('rejects an over-credit update', () => {
    const source = createSourceInvoice();
    const existing = createInitialCreditDraft(
      source,
      [],
      '2026-07-23T10:00:00.000Z',
    );

    expect(() =>
      prepareUpdatedCreditDraft(existing, source, [], {
        subject: '',
        note: '',
        lines: [
          {
            sourceInvoiceLineId: 'line-1',
            description: 'Too much',
            quantityHundredths: 201,
          },
        ],
        updatedAt: '2026-07-23T11:00:00.000Z',
      }),
    ).toThrow(
      'Credit quantity exceeds the remaining source line quantity.',
    );
  });

  it('returns removed source lines as restorable read-only view rows', () => {
    const source = createSourceInvoice();
    const existing = createInitialCreditDraft(
      source,
      [],
      '2026-07-23T10:00:00.000Z',
    );
    const withoutLines: InvoiceDraft = {
      ...existing,
      lines: [],
      totals: {
        netTotalCents: 0,
        vatTotalCents: 0,
        grossTotalCents: 0,
        vatBreakdown: [],
      },
    };

    const view = toCreditInvoiceDraftView(withoutLines, source, []);

    expect(view.lines).toEqual([
      expect.objectContaining({
        sourceInvoiceLineId: 'line-1',
        isIncluded: false,
        quantityHundredths: 0,
        maximumQuantityHundredths: 200,
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2_550,
      }),
    ]);
    expect(view.customer.name).toBe('Example Customer Oy');
    expect(view.billingRecipient.name).toBe('Billing Recipient Oy');
  });
});

function createSourceInvoice(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    approvedAt: '2026-07-01T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCitySnapshot: 'Espoo',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientCustomerTypeSnapshot: 'company',
    billingRecipientEmailSnapshot: 'billing@example.test',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientPhoneSnapshot: '040 000 0002',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientStreetAddressSnapshot: 'Billing Street 2',
    cancellationReason: null,
    cancelledAt: null,
    cancelledBy: null,
    companyBankNameSnapshot: 'Example Bank',
    companyBicSnapshot: 'EXAMPLE1',
    companyBusinessIdSnapshot: '7654321-0',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'seller@example.test',
    companyIbanSnapshot: 'FI0012345600000000',
    companyId: 'company-1',
    companyNameSnapshot: 'Example Seller Oy',
    companyPhoneSnapshot: '040 000 0003',
    companyPostalCodeSnapshot: '33100',
    companyStreetAddressSnapshot: 'Seller Street 3',
    companyVatNumberSnapshot: 'FI76543210',
    companyWebsiteSnapshot: 'example.test',
    createdAt: '2026-07-01T10:00:00.000Z',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    customerBusinessIdSnapshot: '1234567-8',
    customerCitySnapshot: 'Helsinki',
    customerEmailSnapshot: 'customer@example.test',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    customerPhoneSnapshot: '040 000 0001',
    customerPostalCodeSnapshot: '00100',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerTypeSnapshot: 'company',
    deliveryAddressText: 'Worksite 4',
    dueDate: '2026-07-15',
    id: 'invoice-1',
    invoiceDate: '2026-07-01',
    invoiceKind: 'standard',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 20_000,
        code: 'WORK',
        description: 'Work',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 25_100,
        id: 'line-1',
        lineOrder: 1,
        netCents: 20_000,
        quantityHundredths: 200,
        sourceInvoiceLineId: null,
        unit: 'h',
        unitPriceCents: 10_000,
        vatCents: 5_100,
        vatRateBasisPoints: 2_550,
      },
    ],
    note: 'Original note',
    numberingMode: 'calendarYearSequence',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    priceInputMode: 'net',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    reminderPeriodDays: 8,
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    seriesKey: 'default',
    sourceDraftId: 'draft-1',
    status: 'sent',
    subject: 'Original work',
    totals: {
      grossTotalCents: 25_100,
      netTotalCents: 20_000,
      vatBreakdown: [
        {
          grossCents: 25_100,
          netCents: 20_000,
          vatCents: 5_100,
          vatRateBasisPoints: 2_550,
        },
      ],
      vatTotalCents: 5_100,
    },
    updatedAt: '2026-07-01T10:00:00.000Z',
    vatBreakdown: [
      {
        grossCents: 25_100,
        netCents: 20_000,
        vatCents: 5_100,
        vatRateBasisPoints: 2_550,
      },
    ],
    ...overrides,
  };
}
