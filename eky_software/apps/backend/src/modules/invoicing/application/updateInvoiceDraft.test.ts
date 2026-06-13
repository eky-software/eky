import { describe, expect, it } from 'vitest';

import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';
import {
  type UpdateInvoiceDraftDependencies,
  type UpdateInvoiceDraftInput,
  updateInvoiceDraft,
} from './updateInvoiceDraft.js';

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  getCalls: Array<{ companyId: string; invoiceDraftId: string }> = [];
  updatedDraft: InvoiceDraft | undefined;

  constructor(
    private readonly storedDraft?: InvoiceDraft,
    private readonly updateSucceeds = true,
  ) {}

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    return draft;
  }

  async updateDraft(
    draft: InvoiceDraft,
  ): Promise<InvoiceDraft | undefined> {
    if (!this.updateSucceeds) {
      return undefined;
    }

    this.updatedDraft = draft;
    return draft;
  }

  async getDraftById(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceDraft | undefined> {
    this.getCalls.push({ companyId, invoiceDraftId });

    if (
      this.storedDraft?.companyId === companyId &&
      this.storedDraft.id === invoiceDraftId
    ) {
      return this.storedDraft;
    }

    return undefined;
  }

  async listDraftSummaries() {
    return [];
  }
}

class FakeCustomerAccessReader implements CustomerAccessReader {
  calls: Array<{ customerId: string; companyId: string }> = [];

  constructor(private readonly customerBelongsToCompany = true) {}

  async belongsToCompany(
    customerId: string,
    companyId: string,
  ): Promise<boolean> {
    this.calls.push({ customerId, companyId });
    return this.customerBelongsToCompany;
  }
}

function createStoredDraft(): InvoiceDraft {
  const line = calculateInvoiceLine({
    quantityHundredths: 100,
    unitPriceCents: 1000,
    vatRateBasisPoints: 2550,
    priceInputMode: 'net',
    discount: { type: 'none' },
  });
  const lines = [
    {
      ...line,
      id: 'old-line',
      position: 1,
      code: '',
      description: 'Old line',
      unit: 'h' as const,
      discount: { type: 'none' as const },
    },
  ];

  return {
    id: 'draft-1',
    companyId: 'dev-company',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    priceInputMode: 'net',
    subject: 'Old subject',
    orderNumber: '',
    note: '',
    lines,
    totals: calculateInvoiceTotals(lines),
    createdAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  };
}

function createInput(
  overrides: Partial<UpdateInvoiceDraftInput> = {},
): UpdateInvoiceDraftInput {
  return {
    companyId: 'dev-company',
    invoiceDraftId: 'draft-1',
    customerId: 'customer-2',
    invoiceDate: '2026-06-14',
    dueDate: '2026-07-14',
    paymentTermDays: 30,
    priceInputMode: 'gross',
    subject: ' Updated subject ',
    lines: [
      {
        description: ' First new line ',
        quantityHundredths: 150,
        unit: 'h',
        unitPriceCents: 12_550,
        vatRateBasisPoints: 2550,
        discount: { type: 'percentage', basisPoints: 500 },
      },
      {
        description: ' Second new line ',
        quantityHundredths: 100,
        unit: 'km',
        unitPriceCents: 1000,
        vatRateBasisPoints: 1350,
        discount: { type: 'fixed', amountCents: 100 },
      },
    ],
    ...overrides,
  };
}

function createDependencies(
  options: {
    customerBelongsToCompany?: boolean;
    storedDraft?: InvoiceDraft;
    updateSucceeds?: boolean;
  } = {},
): UpdateInvoiceDraftDependencies & {
  customerAccessReader: FakeCustomerAccessReader;
  invoiceDraftRepository: FakeInvoiceDraftRepository;
} {
  return {
    customerAccessReader: new FakeCustomerAccessReader(
      options.customerBelongsToCompany ?? true,
    ),
    invoiceDraftRepository: new FakeInvoiceDraftRepository(
      options.storedDraft,
      options.updateSucceeds,
    ),
  };
}

describe('updateInvoiceDraft', () => {
  it('recalculates and updates an existing company draft', async () => {
    const storedDraft = createStoredDraft();
    const dependencies = createDependencies({ storedDraft });

    const updatedDraft = await updateInvoiceDraft(
      createInput(),
      dependencies,
    );

    expect(dependencies.invoiceDraftRepository.getCalls).toEqual([
      {
        companyId: 'dev-company',
        invoiceDraftId: 'draft-1',
      },
    ]);
    expect(dependencies.customerAccessReader.calls).toEqual([
      {
        customerId: 'customer-2',
        companyId: 'dev-company',
      },
    ]);
    expect(dependencies.invoiceDraftRepository.updatedDraft).toBe(
      updatedDraft,
    );
    expect(updatedDraft).toMatchObject({
      id: 'draft-1',
      companyId: 'dev-company',
      customerId: 'customer-2',
      status: 'draft',
      invoiceDate: '2026-06-14',
      dueDate: '2026-07-14',
      paymentTermDays: 30,
      priceInputMode: 'gross',
      subject: 'Updated subject',
      createdAt: storedDraft.createdAt,
    });
    expect(updatedDraft.updatedAt).not.toBe(storedDraft.updatedAt);
    expect(updatedDraft.lines.map((line) => line.position)).toEqual([1, 2]);
    expect(updatedDraft.lines.map((line) => line.description)).toEqual([
      'First new line',
      'Second new line',
    ]);
    expect(updatedDraft.lines.map((line) => line.id)).not.toContain(
      'old-line',
    );
    expect(updatedDraft.totals).toEqual(
      calculateInvoiceTotals(updatedDraft.lines),
    );
  });

  it('does not update when customer access verification fails', async () => {
    const dependencies = createDependencies({
      customerBelongsToCompany: false,
      storedDraft: createStoredDraft(),
    });

    await expect(
      updateInvoiceDraft(createInput(), dependencies),
    ).rejects.toThrow('Customer is not available for invoicing.');

    expect(dependencies.customerAccessReader.calls).toEqual([
      {
        customerId: 'customer-2',
        companyId: 'dev-company',
      },
    ]);
    expect(
      dependencies.invoiceDraftRepository.updatedDraft,
    ).toBeUndefined();
  });

  it('returns the same generic not-found error outside the company scope', async () => {
    const dependencies = createDependencies({
      storedDraft: createStoredDraft(),
    });

    await expect(
      updateInvoiceDraft(
        createInput({ companyId: 'other-company' }),
        dependencies,
      ),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());

    expect(dependencies.customerAccessReader.calls).toEqual([]);
    expect(
      dependencies.invoiceDraftRepository.updatedDraft,
    ).toBeUndefined();
  });

  it('returns a generic not-found error if the scoped update loses the draft', async () => {
    const dependencies = createDependencies({
      storedDraft: createStoredDraft(),
      updateSucceeds: false,
    });

    await expect(
      updateInvoiceDraft(createInput(), dependencies),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());
  });

  it('rejects a non-draft invoice before customer access or persistence', async () => {
    const nonDraftInvoice = {
      ...createStoredDraft(),
      status: 'approved',
    } as unknown as InvoiceDraft;
    const dependencies = createDependencies({
      storedDraft: nonDraftInvoice,
    });

    await expect(
      updateInvoiceDraft(createInput(), dependencies),
    ).rejects.toThrow('Only invoice drafts can be updated.');

    expect(dependencies.customerAccessReader.calls).toEqual([]);
    expect(
      dependencies.invoiceDraftRepository.updatedDraft,
    ).toBeUndefined();
  });
});
