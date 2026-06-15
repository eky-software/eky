import type { InvoiceDraft } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { toNewInvoiceFormStateFromDraft } from './invoiceDraftFormHydration.js';

describe('toNewInvoiceFormStateFromDraft', () => {
  it('fills invoice basic information from an existing draft', () => {
    const form = toNewInvoiceFormStateFromDraft(createInvoiceDraft());

    expect(form).toMatchObject({
      customerId: 'customer-1',
      dueDate: '2026-06-30',
      invoiceDate: '2026-06-16',
      note: 'Saate',
      orderNumber: 'ORDER-1',
      paymentTermDays: '14',
      priceInputMode: 'net',
      subject: 'Työlasku',
    });
  });

  it('fills rows and converts quantity and unit price back to UI text', () => {
    const form = toNewInvoiceFormStateFromDraft(createInvoiceDraft());

    expect(form.lines[0]).toMatchObject({
      description: 'Työtunti',
      quantity: '1,50',
      unit: 'h',
      unitPrice: '65,50',
      vatRateBasisPoints: 2550,
    });
  });

  it('converts percentage discounts back to UI form values', () => {
    const form = toNewInvoiceFormStateFromDraft(createInvoiceDraft());

    expect(form.lines[0]).toMatchObject({
      discountType: 'percentage',
      discountValue: '10,50',
    });
  });

  it('converts fixed discounts back to UI form values', () => {
    const draft = createInvoiceDraft();
    const firstLine = draft.lines[0];

    if (firstLine === undefined) {
      throw new Error('Expected a test invoice line.');
    }

    const form = toNewInvoiceFormStateFromDraft({
      ...draft,
      lines: [
        {
          ...firstLine,
          discount: {
            amountCents: 500,
            type: 'fixed',
          },
        },
      ],
    });

    expect(form.lines[0]).toMatchObject({
      discountType: 'fixed',
      discountValue: '5,00',
    });
  });
});

function createInvoiceDraft(): InvoiceDraft {
  return {
    companyId: 'dev-company',
    createdAt: '2026-06-16T12:00:00.000Z',
    customerId: 'customer-1',
    dueDate: '2026-06-30',
    id: 'draft-1',
    invoiceDate: '2026-06-16',
    lines: [
      {
        baseCents: 9825,
        code: '',
        description: 'Työtunti',
        discount: {
          basisPoints: 1050,
          type: 'percentage',
        },
        discountCents: 1032,
        grossCents: 11_035,
        id: 'line-1',
        netCents: 8793,
        position: 1,
        priceInputMode: 'net',
        quantityHundredths: 150,
        unit: 'h',
        unitPriceCents: 6550,
        vatCents: 2242,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Saate',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    priceInputMode: 'net',
    status: 'draft',
    subject: 'Työlasku',
    totals: {
      grossTotalCents: 11_035,
      netTotalCents: 8793,
      vatBreakdown: [
        {
          grossCents: 11_035,
          netCents: 8793,
          vatCents: 2242,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2242,
    },
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}
