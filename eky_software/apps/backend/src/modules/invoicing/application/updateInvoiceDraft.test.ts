import { describe, expect, it } from 'vitest';

import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type {
  StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import type { InvoicePaymentSettingsRepository } from '../ports/invoicePaymentSettingsRepository.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';
import {
  type UpdateInvoiceDraftDependencies,
  type UpdateInvoiceDraftInput,
  updateInvoiceDraft,
} from './updateInvoiceDraft.js';

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  getCalls: Array<{ companyId: string; invoiceDraftId: string }> = [];
  updatedDraft: InvoiceDraft | undefined;

  async deleteDraft(): Promise<boolean> {
    return false;
  }

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
  private readonly deniedCustomerIds = new Set<string>();

  constructor(private readonly customerBelongsToCompany = true) {}

  denyCustomer(customerId: string): void {
    this.deniedCustomerIds.add(customerId);
  }

  async belongsToCompany(
    customerId: string,
    companyId: string,
  ): Promise<boolean> {
    this.calls.push({ customerId, companyId });
    return (
      this.customerBelongsToCompany &&
      !this.deniedCustomerIds.has(customerId)
    );
  }
}

class FakeInvoicePaymentSettingsRepository
  implements InvoicePaymentSettingsRepository
{
  async getSettings(): Promise<StoredInvoicePaymentSettings | undefined> {
    return undefined;
  }

  async saveSettings(
    settings: StoredInvoicePaymentSettings,
  ): Promise<StoredInvoicePaymentSettings> {
    return settings;
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
      sourceInvoiceLineId: null,
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
    subject: 'Old subject',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    refundIban: '',
    lines,
    totals: calculateInvoiceTotals(
      lines.map((line) => {
        if (line.vatRateBasisPoints === null) {
          throw new Error('Normal VAT test line requires a VAT rate.');
        }
        return {
          ...line,
          vatRateBasisPoints: line.vatRateBasisPoints,
        };
      }),
    ),
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
    billingRecipientCustomerId: 'billing-customer-2',
    invoiceDate: '2026-06-14',
    dueDate: '2026-07-14',
    paymentTermDays: 30,
    reminderPeriodDays: 12,
    latePaymentInterestBasisPoints: 1200,
    priceInputMode: 'gross',
    subject: ' Updated subject ',
    deliveryAddressText: ' Kohde B ',
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
  invoicePaymentSettingsRepository: FakeInvoicePaymentSettingsRepository;
} {
  return {
    customerAccessReader: new FakeCustomerAccessReader(
      options.customerBelongsToCompany ?? true,
    ),
    invoiceCustomerTaxProfileReader: {
      async getTaxProfile() {
        return {
          customerType: 'company',
          businessId: '1234567-8',
        };
      },
    },
    invoiceDraftRepository: new FakeInvoiceDraftRepository(
      options.storedDraft,
      options.updateSucceeds,
    ),
    invoicePaymentSettingsRepository:
      new FakeInvoicePaymentSettingsRepository(),
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
      {
        customerId: 'billing-customer-2',
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
      billingRecipientCustomerId: 'billing-customer-2',
      status: 'draft',
      invoiceDate: '2026-06-14',
      dueDate: '2026-07-14',
      paymentTermDays: 30,
      reminderPeriodDays: 12,
      latePaymentInterestBasisPoints: 1200,
      priceInputMode: 'gross',
      subject: 'Updated subject',
      deliveryAddressText: 'Kohde B',
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
      calculateInvoiceTotals(
        updatedDraft.lines.map((line) => {
          if (line.vatRateBasisPoints === null) {
            throw new Error('Normal VAT test line requires a VAT rate.');
          }
          return {
            ...line,
            vatRateBasisPoints: line.vatRateBasisPoints,
          };
        }),
      ),
    );
  });

  it('updates a standard draft to eligible reverse charge content', async () => {
    const dependencies = createDependencies({
      storedDraft: createStoredDraft(),
    });

    const updatedDraft = await updateInvoiceDraft(
      createInput({
        priceInputMode: 'net',
        taxTreatment: 'reverseChargeConstruction',
        performancePeriod: {
          type: 'singleDate',
          date: '2026-06-14',
        },
        lines: [
          {
            description: 'Construction service',
            quantityHundredths: 100,
            unit: 'h',
            unitPriceCents: 10_000,
            discount: { type: 'none' },
          },
        ],
      }),
      dependencies,
    );

    expect(updatedDraft).toMatchObject({
      taxTreatment: 'reverseChargeConstruction',
      performancePeriod: {
        type: 'singleDate',
        date: '2026-06-14',
      },
      totals: {
        netTotalCents: 10_000,
        vatTotalCents: 0,
        grossTotalCents: 10_000,
        vatBreakdown: [],
      },
    });
    expect(updatedDraft.lines[0]).toMatchObject({
      vatRateBasisPoints: null,
      vatCents: 0,
      netCents: 10_000,
      grossCents: 10_000,
    });
  });

  it('does not update reverse charge content for an ineligible customer', async () => {
    const dependencies = createDependencies({
      storedDraft: createStoredDraft(),
    });
    dependencies.invoiceCustomerTaxProfileReader = {
      async getTaxProfile() {
        return { customerType: 'privatePerson', businessId: '' };
      },
    };

    await expect(
      updateInvoiceDraft(
        createInput({
          priceInputMode: 'net',
          taxTreatment: 'reverseChargeConstruction',
          lines: [
            {
              description: 'Construction service',
              quantityHundredths: 100,
              unit: 'h',
              unitPriceCents: 10_000,
              discount: { type: 'none' },
            },
          ],
        }),
        dependencies,
      ),
    ).rejects.toThrow(
      'Reverse charge cannot be used for a private customer.',
    );
    expect(dependencies.invoiceDraftRepository.updatedDraft).toBeUndefined();
  });

  it('preserves the existing late payment interest when update input omits it', async () => {
    const storedDraft = createStoredDraft();
    const dependencies = createDependencies({ storedDraft });
    const { latePaymentInterestBasisPoints: _omitted, ...input } =
      createInput();

    const updatedDraft = await updateInvoiceDraft(input, dependencies);

    expect(updatedDraft.latePaymentInterestBasisPoints).toBe(
      storedDraft.latePaymentInterestBasisPoints,
    );
  });

  it('preserves the existing reminder period when update input omits it', async () => {
    const storedDraft = createStoredDraft();
    const dependencies = createDependencies({ storedDraft });
    const { reminderPeriodDays: _omitted, ...input } = createInput();

    const updatedDraft = await updateInvoiceDraft(input, dependencies);

    expect(updatedDraft.reminderPeriodDays).toBe(
      storedDraft.reminderPeriodDays,
    );
  });

  it('does not update when billing recipient access verification fails', async () => {
    const dependencies = createDependencies({
      storedDraft: createStoredDraft(),
    });
    dependencies.customerAccessReader.denyCustomer('billing-customer-2');

    await expect(
      updateInvoiceDraft(createInput(), dependencies),
    ).rejects.toThrow('Billing recipient is not available for invoicing.');

    expect(dependencies.customerAccessReader.calls).toEqual([
      {
        customerId: 'customer-2',
        companyId: 'dev-company',
      },
      {
        customerId: 'billing-customer-2',
        companyId: 'dev-company',
      },
    ]);
    expect(
      dependencies.invoiceDraftRepository.updatedDraft,
    ).toBeUndefined();
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
