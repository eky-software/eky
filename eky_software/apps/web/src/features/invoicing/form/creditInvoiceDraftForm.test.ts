import type { CreditInvoiceDraft } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import {
  formatCreditQuantityInput,
  hydrateCreditInvoiceDraftForm,
  validateAndMapCreditInvoiceDraftForm,
} from './creditInvoiceDraftForm.js';

describe('creditInvoiceDraftForm', () => {
  it('hydrates all creditable source lines without losing omitted lines', () => {
    const form = hydrateCreditInvoiceDraftForm(createCreditDraft());

    expect(form.lines).toEqual([
      expect.objectContaining({
        isIncluded: true,
        quantity: '1,50',
        sourceInvoiceLineId: 'source-line-1',
      }),
      expect.objectContaining({
        isIncluded: false,
        quantity: '0,00',
        sourceInvoiceLineId: 'source-line-2',
      }),
    ]);
  });

  it('maps only selected editable values to the API input', () => {
    const form = hydrateCreditInvoiceDraftForm(createCreditDraft());
    form.subject = '  Osahyvitys  ';
    form.note = '  Korjattu määrä  ';
    form.lines[0] = {
      ...form.lines[0]!,
      description: '  Hyvitetty työ  ',
      quantity: '1,25',
    };

    expect(validateAndMapCreditInvoiceDraftForm(form)).toEqual({
      errors: [],
      input: {
        subject: 'Osahyvitys',
        note: 'Korjattu määrä',
        lines: [
          {
            sourceInvoiceLineId: 'source-line-1',
            description: 'Hyvitetty työ',
            quantityHundredths: 125,
          },
        ],
      },
    });
  });

  it('rejects an empty credit and quantities above the remaining capacity', () => {
    const form = hydrateCreditInvoiceDraftForm(createCreditDraft());
    form.lines[0] = {
      ...form.lines[0]!,
      quantity: '2,01',
    };

    expect(validateAndMapCreditInvoiceDraftForm(form)).toEqual({
      errors: ['quantity'],
      input: null,
    });

    form.lines = form.lines.map((line) => ({
      ...line,
      isIncluded: false,
    }));

    expect(validateAndMapCreditInvoiceDraftForm(form)).toEqual({
      errors: ['lines'],
      input: null,
    });
  });

  it('formats hundredths without floating point arithmetic', () => {
    expect(formatCreditQuantityInput(1)).toBe('0,01');
    expect(formatCreditQuantityInput(125)).toBe('1,25');
    expect(formatCreditQuantityInput(10_000)).toBe('100,00');
  });
});

function createCreditDraft(): CreditInvoiceDraft {
  return {
    id: 'credit-draft-1',
    invoiceKind: 'credit',
    creditedInvoiceId: 'invoice-1',
    creditedInvoiceNumber: '20260001',
    creditedInvoiceDate: '2026-07-01',
    customer: createParty('customer-1', '1001', 'Asiakas Oy'),
    billingRecipient: createParty(
      'billing-1',
      '2001',
      'Vastaanottaja Oy',
    ),
    invoiceDate: '2026-07-23',
    dueDate: '2026-07-23',
    paymentTermDays: 0,
    reminderPeriodDays: 0,
    latePaymentInterestBasisPoints: 0,
    priceInputMode: 'net',
    subject: 'Hyvityslasku laskulle 20260001',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    lines: [
      createLine({
        isIncluded: true,
        quantityHundredths: 150,
        sourceInvoiceLineId: 'source-line-1',
      }),
      createLine({
        isIncluded: false,
        quantityHundredths: 0,
        sourceInvoiceLineId: 'source-line-2',
      }),
    ],
    totals: {
      netTotalCents: 15_000,
      vatTotalCents: 3_825,
      grossTotalCents: 18_825,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2_550,
          netCents: 15_000,
          vatCents: 3_825,
          grossCents: 18_825,
        },
      ],
    },
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
  };
}

function createParty(
  customerId: string,
  customerNumber: string,
  name: string,
) {
  return {
    customerId,
    customerNumber,
    name,
    businessId: '',
    email: '',
    phone: '',
    streetAddress: '',
    postalCode: '',
    city: '',
  };
}

function createLine(
  overrides: Partial<CreditInvoiceDraft['lines'][number]>,
): CreditInvoiceDraft['lines'][number] {
  return {
    id: null,
    sourceInvoiceLineId: 'source-line-1',
    isIncluded: true,
    position: 1,
    code: 'WORK',
    description: 'Työ',
    quantityHundredths: 200,
    maximumQuantityHundredths: 200,
    unit: 'h',
    unitPriceCents: 10_000,
    vatRateBasisPoints: 2_550,
    discount: { type: 'none' },
    baseCents: 20_000,
    discountCents: 0,
    netCents: 20_000,
    vatCents: 5_100,
    grossCents: 25_100,
    ...overrides,
  };
}

