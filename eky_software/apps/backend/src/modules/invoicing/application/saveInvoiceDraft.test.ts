import { describe, expect, it } from 'vitest';

import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import {
  saveInvoiceDraft,
  type SaveInvoiceDraftDependencies,
  type SaveInvoiceDraftInput,
} from './saveInvoiceDraft.js';

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  savedDraft: InvoiceDraft | undefined;

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    this.savedDraft = draft;
    return draft;
  }

  async getDraftById(): Promise<InvoiceDraft | undefined> {
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

function createDependencies(
  customerBelongsToCompany = true,
): SaveInvoiceDraftDependencies & {
  customerAccessReader: FakeCustomerAccessReader;
  invoiceDraftRepository: FakeInvoiceDraftRepository;
} {
  return {
    customerAccessReader: new FakeCustomerAccessReader(
      customerBelongsToCompany,
    ),
    invoiceDraftRepository: new FakeInvoiceDraftRepository(),
  };
}

function createInput(
  overrides: Partial<SaveInvoiceDraftInput> = {},
): SaveInvoiceDraftInput {
  return {
    companyId: 'dev-company',
    customerId: 'customer-1',
    invoiceDate: '2026-06-13',
    priceInputMode: 'net',
    subject: ' Test invoice ',
    lines: [
      {
        code: ' WORK ',
        description: ' Installation work ',
        quantityHundredths: 150,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2550,
        discount: { type: 'percentage', basisPoints: 500 },
      },
      {
        description: ' Travel ',
        quantityHundredths: 100,
        unit: 'km',
        unitPriceCents: 1000,
        vatRateBasisPoints: 1350,
        discount: { type: 'none' },
      },
    ],
    ...overrides,
  };
}

describe('saveInvoiceDraft', () => {
  it('calculates and saves a draft through the repository port', async () => {
    const dependencies = createDependencies();

    const draft = await saveInvoiceDraft(createInput(), dependencies);

    expect(dependencies.customerAccessReader.calls).toEqual([
      {
        customerId: 'customer-1',
        companyId: 'dev-company',
      },
    ]);
    expect(dependencies.invoiceDraftRepository.savedDraft).toBe(draft);
    expect(draft).toMatchObject({
      companyId: 'dev-company',
      customerId: 'customer-1',
      status: 'draft',
      invoiceDate: '2026-06-13',
      dueDate: '2026-06-27',
      paymentTermDays: 14,
      priceInputMode: 'net',
      subject: 'Test invoice',
    });
    expect(draft.id).toEqual(expect.any(String));
    expect(draft.lines.map((line) => line.position)).toEqual([1, 2]);
    expect(draft.lines.map((line) => line.description)).toEqual([
      'Installation work',
      'Travel',
    ]);
    expect(draft.lines[0]).toMatchObject({
      code: 'WORK',
      baseCents: 15_000,
      discountCents: 750,
      netCents: 14_250,
      vatCents: 3634,
      grossCents: 17_884,
    });
    expect(draft.totals).toEqual({
      netTotalCents: 15_250,
      vatTotalCents: 3769,
      grossTotalCents: 19_019,
      vatBreakdown: [
        {
          vatRateBasisPoints: 1350,
          netCents: 1000,
          vatCents: 135,
          grossCents: 1135,
        },
        {
          vatRateBasisPoints: 2550,
          netCents: 14_250,
          vatCents: 3634,
          grossCents: 17_884,
        },
      ],
    });
    expect(draft.createdAt).toBe(draft.updatedAt);
  });

  it('keeps a manually provided due date', async () => {
    const draft = await saveInvoiceDraft(
      createInput({
        dueDate: '2026-07-15',
        paymentTermDays: 30,
      }),
      createDependencies(),
    );

    expect(draft.dueDate).toBe('2026-07-15');
    expect(draft.paymentTermDays).toBe(30);
  });

  it('rejects drafts without lines before calling the repository', async () => {
    const dependencies = createDependencies();

    await expect(
      saveInvoiceDraft(createInput({ lines: [] }), dependencies),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(dependencies.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('rejects unsupported invoice units before calling the repository', async () => {
    const dependencies = createDependencies();
    const input = createInput({
      lines: [
        {
          description: 'Unsupported unit',
          quantityHundredths: 100,
          unit: 'box',
          unitPriceCents: 1000,
          vatRateBasisPoints: 2550,
          discount: { type: 'none' },
        },
      ],
    });

    await expect(
      saveInvoiceDraft(input, dependencies),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(dependencies.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('does not save a draft when the customer is outside the company', async () => {
    const dependencies = createDependencies(false);

    await expect(
      saveInvoiceDraft(createInput(), dependencies),
    ).rejects.toThrow('Customer is not available for invoicing.');

    expect(dependencies.customerAccessReader.calls).toEqual([
      {
        customerId: 'customer-1',
        companyId: 'dev-company',
      },
    ]);
    expect(dependencies.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('uses the same generic error when customer access is denied', async () => {
    const dependencies = createDependencies(false);

    try {
      await saveInvoiceDraft(createInput(), dependencies);
      throw new Error('Expected customer access validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(InvoiceDraftValidationError);
      expect(error).toMatchObject({
        message: 'Customer is not available for invoicing.',
      });
      expect(error).not.toMatchObject({
        message: expect.stringMatching(/other company|not found/i),
      });
    }
  });
});
