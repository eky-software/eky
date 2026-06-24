import { describe, expect, it } from 'vitest';

import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { InvoiceDraftSummary } from '../domain/invoiceDraftSummary.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { listInvoiceDrafts } from './listInvoiceDrafts.js';

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  listCalls: Array<{ companyId: string; customerId?: string }> = [];

  async deleteDraft(): Promise<boolean> {
    return false;
  }

  constructor(
    private readonly summaries: InvoiceDraftSummary[] = [],
  ) {}

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    return draft;
  }

  async updateDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    return draft;
  }

  async getDraftById(): Promise<InvoiceDraft | undefined> {
    return undefined;
  }

  async listDraftSummaries(
    companyId: string,
    customerId?: string,
  ): Promise<InvoiceDraftSummary[]> {
    const call: { companyId: string; customerId?: string } = { companyId };

    if (customerId !== undefined) {
      call.customerId = customerId;
    }

    this.listCalls.push(call);
    return this.summaries;
  }
}

describe('listInvoiceDrafts', () => {
  it('lists company drafts without an optional customer filter', async () => {
    const repository = new FakeInvoiceDraftRepository();

    await listInvoiceDrafts(
      { companyId: ' dev-company ' },
      repository,
    );

    expect(repository.listCalls).toEqual([
      {
        companyId: 'dev-company',
      },
    ]);
  });

  it('normalizes and passes an optional customer filter', async () => {
    const repository = new FakeInvoiceDraftRepository();

    await listInvoiceDrafts(
      {
        companyId: 'dev-company',
        customerId: ' customer-1 ',
      },
      repository,
    );

    expect(repository.listCalls).toEqual([
      {
        companyId: 'dev-company',
        customerId: 'customer-1',
      },
    ]);
  });

  it('rejects an invalid customer filter before calling the repository', async () => {
    const repository = new FakeInvoiceDraftRepository();

    await expect(
      listInvoiceDrafts(
        {
          companyId: 'dev-company',
          customerId: 'x'.repeat(201),
        },
        repository,
      ),
    ).rejects.toThrow('Customer id is invalid.');
    expect(repository.listCalls).toEqual([]);
  });
});
