import { describe, expect, it } from 'vitest';

import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { getInvoiceDraft } from './getInvoiceDraft.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  getCalls: Array<{ companyId: string; invoiceDraftId: string }> = [];

  constructor(private readonly invoiceDraft?: InvoiceDraft) {}

  async deleteDraft(): Promise<boolean> {
    return false;
  }

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    return draft;
  }

  async updateDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    return draft;
  }

  async getDraftById(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceDraft | undefined> {
    this.getCalls.push({ companyId, invoiceDraftId });
    return this.invoiceDraft;
  }

  async listDraftSummaries() {
    return [];
  }
}

function createDraft(): InvoiceDraft {
  return {
    id: 'draft-1',
    companyId: 'dev-company',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: '',
    note: '',
    lines: [],
    totals: {
      netTotalCents: 0,
      vatTotalCents: 0,
      grossTotalCents: 0,
      vatBreakdown: [],
    },
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}

describe('getInvoiceDraft', () => {
  it('gets a draft through the company-scoped repository port', async () => {
    const draft = createDraft();
    const repository = new FakeInvoiceDraftRepository(draft);

    const result = await getInvoiceDraft(
      {
        companyId: ' dev-company ',
        invoiceDraftId: ' draft-1 ',
      },
      repository,
    );

    expect(result).toBe(draft);
    expect(repository.getCalls).toEqual([
      {
        companyId: 'dev-company',
        invoiceDraftId: 'draft-1',
      },
    ]);
  });

  it('throws the same generic not-found error for an unavailable draft', async () => {
    const repository = new FakeInvoiceDraftRepository();

    await expect(
      getInvoiceDraft(
        {
          companyId: 'dev-company',
          invoiceDraftId: 'missing-draft',
        },
        repository,
      ),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());
  });
});
