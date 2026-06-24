import { describe, expect, it } from 'vitest';

import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { deleteInvoiceDraft } from './deleteInvoiceDraft.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  deleteCalls: Array<{ companyId: string; invoiceDraftId: string }> = [];

  constructor(private readonly deleteResult: boolean) {}

  async deleteDraft(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<boolean> {
    this.deleteCalls.push({ companyId, invoiceDraftId });
    return this.deleteResult;
  }

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    return draft;
  }

  async updateDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    return draft;
  }

  async getDraftById(): Promise<InvoiceDraft | undefined> {
    return undefined;
  }

  async listDraftSummaries() {
    return [];
  }
}

describe('deleteInvoiceDraft', () => {
  it('deletes a draft through the company-scoped repository port', async () => {
    const repository = new FakeInvoiceDraftRepository(true);

    await expect(
      deleteInvoiceDraft(
        {
          companyId: ' dev-company ',
          invoiceDraftId: ' draft-1 ',
        },
        repository,
      ),
    ).resolves.toBeUndefined();
    expect(repository.deleteCalls).toEqual([
      {
        companyId: 'dev-company',
        invoiceDraftId: 'draft-1',
      },
    ]);
  });

  it('uses the same generic not-found error for an unavailable draft', async () => {
    const repository = new FakeInvoiceDraftRepository(false);

    await expect(
      deleteInvoiceDraft(
        {
          companyId: 'dev-company',
          invoiceDraftId: 'missing-draft',
        },
        repository,
      ),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());
  });

  it('rejects an invoice draft id that exceeds the accepted length', async () => {
    const repository = new FakeInvoiceDraftRepository(true);

    await expect(
      deleteInvoiceDraft(
        {
          companyId: 'dev-company',
          invoiceDraftId: 'x'.repeat(201),
        },
        repository,
      ),
    ).rejects.toThrow('Invoice draft id is invalid.');
    expect(repository.deleteCalls).toEqual([]);
  });
});
