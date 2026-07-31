import type { ApprovedInvoiceSummary } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import {
  toApprovedRows,
  toDraftRows,
  toSentRows,
} from './customerInvoiceRows.js';

describe('customer invoice rows', () => {
  it('creates a typed draft navigation request', () => {
    const rows = toDraftRows([
      {
        creditedInvoiceId: null,
        customerId: 'customer-1',
        dueDate: '2026-08-15',
        grossTotalCents: 12_400,
        id: 'draft-1',
        invoiceDate: '2026-08-01',
        invoiceKind: 'standard',
        latePaymentInterestBasisPoints: 950,
        netTotalCents: 10_000,
        paymentTermDays: 14,
        priceInputMode: 'net',
        status: 'draft',
        subject: 'Ikkunatyö',
        updatedAt: '2026-08-02T10:00:00.000Z',
        vatTotalCents: 2_400,
      },
    ]);

    expect(rows[0]?.target).toEqual({
      id: 'draft-1',
      invoiceKind: 'standard',
      type: 'draft',
    });
    expect(rows[0]?.date).toBe('2026-08-01');
  });

  it('keeps credit notes with their root invoice and exposes both', () => {
    const rootInvoice = createApprovedInvoice({
      id: 'invoice-1',
      invoiceNumber: '2026001',
    });
    const creditInvoice = createApprovedInvoice({
      creditedInvoiceId: rootInvoice.id,
      id: 'credit-1',
      invoiceKind: 'credit',
      invoiceNumber: '2026002',
    });
    const rows = toSentRows([
      {
        creditInvoices: [creditInvoice],
        creditStatus: 'partial',
        remainingCreditableGrossCents: 6_200,
        rootInvoice,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reference: '2026001',
      status: 'Osittain hyvitetty',
    });
    expect(rows[1]).toMatchObject({
      isCredit: true,
      reference: '2026002',
      relation: 'Hyvittää laskua 2026001',
    });
  });

  it('labels cancelled invoices without changing their open target', () => {
    const rows = toApprovedRows(
      [createApprovedInvoice({ status: 'cancelled' })],
      'cancelled',
    );

    expect(rows[0]).toMatchObject({
      status: 'Peruttu',
      target: {
        id: 'invoice-1',
        type: 'approvedInvoice',
      },
    });
  });

  it('labels an uncredited paid invoice as paid', () => {
    const rootInvoice = createApprovedInvoice({
      paidAmountCents: 12_400,
      paidOn: '2026-08-20',
      paymentSource: 'manual',
      paymentState: 'paid',
    });
    const rows = toSentRows([
      {
        creditInvoices: [],
        creditStatus: 'none',
        remainingCreditableGrossCents: 12_400,
        rootInvoice,
      },
    ]);

    expect(rows[0]?.status).toBe('Maksettu');
    expect(rows[0]?.paidOn).toBe('2026-08-20');
  });

  it('keeps paid as an additional status for a credited root invoice', () => {
    const rootInvoice = createApprovedInvoice({
      paidAmountCents: 6_200,
      paidOn: '2026-08-20',
      paymentSource: 'manual',
      paymentState: 'paid',
    });
    const rows = toSentRows([
      {
        creditInvoices: [
          createApprovedInvoice({
            creditedInvoiceId: rootInvoice.id,
            id: 'credit-1',
            invoiceKind: 'credit',
            invoiceNumber: '2026002',
          }),
        ],
        creditStatus: 'partial',
        remainingCreditableGrossCents: 6_200,
        rootInvoice,
      },
    ]);

    expect(rows[0]?.status).toBe('Osittain hyvitetty · Maksettu');
  });
});

function createApprovedInvoice(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
  return {
    approvedAt: '2026-08-01T10:00:00.000Z',
    billingRecipientNameSnapshot: 'Esimerkki Oy',
    cancelledAt: null,
    creditedInvoiceId: null,
    customerId: 'customer-1',
    customerNameSnapshot: 'Esimerkki Oy',
    customerNumberSnapshot: '1001',
    dueDate: '2026-08-15',
    grossTotalCents: 12_400,
    id: 'invoice-1',
    invoiceDate: '2026-08-01',
    invoiceKind: 'standard',
    invoiceNumber: '2026001',
    referenceNumber: '20260013',
    status: 'sent',
    updatedAt: '2026-08-01T10:00:00.000Z',
    paymentState:
      overrides.invoiceKind === 'credit' ? 'notApplicable' : 'unpaid',
    paidOn: null,
    paidAmountCents: null,
    paymentSource: null,
    ...overrides,
  };
}
