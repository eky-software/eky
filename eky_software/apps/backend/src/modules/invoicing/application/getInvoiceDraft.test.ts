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
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    customerId: 'customer-1',
    billingRecipientCustomerId: null,
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    performancePeriod: { type: 'invoiceDate' },
    subject: 'Test invoice',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    refundIban: '',
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

    expect(result).toEqual(draft);
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

  it('normalizes draft totals from VAT-rate totals before returning it', async () => {
    const draft = {
      ...createDraft(),
      lines: [
        createDraftLine('line-1', 1, 5_500),
        ...Array.from({ length: 25 }, (_, index) =>
          createDraftLine(`line-small-${index + 1}`, index + 2, 100),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          createDraftLine(`line-medium-${index + 1}`, index + 27, 1_100),
        ),
      ],
      totals: {
        netTotalCents: 12_400,
        vatTotalCents: 3_177,
        grossTotalCents: 15_577,
        vatBreakdown: [
          {
            vatRateBasisPoints: 2550,
            netCents: 12_400,
            vatCents: 3_177,
            grossCents: 15_577,
          },
        ],
      },
    };
    const repository = new FakeInvoiceDraftRepository(draft);

    await expect(
      getInvoiceDraft(
        {
          companyId: 'dev-company',
          invoiceDraftId: 'draft-1',
        },
        repository,
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
    });
  });
});

function createDraftLine(
  id: string,
  position: number,
  netCents: number,
): InvoiceDraft['lines'][number] {
  const vatCents = Math.round((netCents * 2550) / 10_000);

  return {
    id,
    sourceInvoiceLineId: null,
    position,
    code: '',
    description: 'Test line',
    quantityHundredths: 100,
    unit: 'kpl',
    unitPriceCents: netCents,
    vatRateBasisPoints: 2550,
    priceInputMode: 'net',
    discount: { type: 'none' },
    baseCents: netCents,
    discountCents: 0,
    netCents,
    vatCents,
    grossCents: netCents + vatCents,
  };
}
