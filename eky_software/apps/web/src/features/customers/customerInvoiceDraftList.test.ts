import type { InvoiceDraftSummary } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { createCustomerInvoiceDraftPage } from './customerInvoiceDraftList.js';

describe('customer invoice draft list', () => {
  it('sorts and paginates drafts with the customer-card controls', () => {
    const drafts = [
      createDraft('draft-3', '2026-08-03', '2026-08-20'),
      createDraft('draft-1', '2026-08-01', '2026-08-30'),
      createDraft('draft-2', '2026-08-02', '2026-08-10'),
      createDraft('draft-4', '2026-08-04', '2026-08-21'),
      createDraft('draft-5', '2026-08-05', '2026-08-22'),
      createDraft('draft-6', '2026-08-06', '2026-08-23'),
    ];

    expect(
      createCustomerInvoiceDraftPage(drafts, 1, 5, 'invoiceDateDesc').items.map(
        (draft) => draft.id,
      ),
    ).toEqual(['draft-6', 'draft-5', 'draft-4', 'draft-3', 'draft-2']);
    expect(
      createCustomerInvoiceDraftPage(drafts, 1, 5, 'dueDateAsc').items.map(
        (draft) => draft.id,
      ),
    ).toEqual(['draft-2', 'draft-3', 'draft-4', 'draft-5', 'draft-6']);

    const secondPage = createCustomerInvoiceDraftPage(
      drafts,
      2,
      5,
      'invoiceDateAsc',
    );

    expect(secondPage.items.map((draft) => draft.id)).toEqual(['draft-6']);
    expect(secondPage.totalPages).toBe(2);
  });
});

function createDraft(
  id: string,
  invoiceDate: string,
  dueDate: string,
): InvoiceDraftSummary {
  return {
    creditedInvoiceId: null,
    customerId: 'customer-1',
    dueDate,
    grossTotalCents: 12_400,
    id,
    invoiceDate,
    invoiceKind: 'standard',
    latePaymentInterestBasisPoints: 950,
    netTotalCents: 10_000,
    paymentTermDays: 14,
    priceInputMode: 'net',
    status: 'draft',
    subject: id,
    updatedAt: '2026-08-01T10:00:00.000Z',
    vatTotalCents: 2_400,
  };
}
