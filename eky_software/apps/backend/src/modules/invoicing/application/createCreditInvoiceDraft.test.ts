import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceCreditDraftRepository } from '../ports/invoiceCreditDraftRepository.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import {
  createCreditInvoiceDraft,
  type CreateCreditInvoiceDraftDependencies,
  type CreateCreditInvoiceDraftInput,
} from './createCreditInvoiceDraft.js';
import { InvoiceCreditConflictError } from './invoiceCreditConflictError.js';

describe('createCreditInvoiceDraft', () => {
  it('requires correction permission before reading invoice data', async () => {
    const getApprovedInvoiceById = vi.fn<
      ApprovedInvoiceReader['getApprovedInvoiceById']
    >();

    await expect(
      createCreditInvoiceDraft(
        createInput({
          actorContext: createActorContext({
            actorId: 'user-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          }),
        }),
        createDependencies({ getApprovedInvoiceById }),
      ),
    ).rejects.toThrow('Permission denied');

    expect(getApprovedInvoiceById).not.toHaveBeenCalled();
  });

  it('rejects a source invoice that is not a sent standard invoice', async () => {
    await expect(
      createCreditInvoiceDraft(
        createInput(),
        createDependencies({
          invoice: createInvoice({ status: 'approved' }),
        }),
      ),
    ).rejects.toBeInstanceOf(InvoiceCreditConflictError);
  });

  it('returns the existing active draft idempotently', async () => {
    const invoice = createInvoice();
    const existingDraft = {
      id: 'credit-draft-existing',
      companyId: 'company-1',
      invoiceKind: 'credit' as const,
      creditedInvoiceId: 'invoice-1',
      customerId: 'customer-1',
      billingRecipientCustomerId: null,
      status: 'draft' as const,
      invoiceDate: '2026-07-23',
      dueDate: '2026-07-23',
      paymentTermDays: 0,
      reminderPeriodDays: 0,
      latePaymentInterestBasisPoints: 0,
      priceInputMode: 'net' as const,
      taxTreatment: 'normalVat' as const,
      performancePeriod: { type: 'invoiceDate' as const },
      subject: 'Credit',
      orderNumber: '',
      note: '',
      deliveryAddressText: '',
      refundIban: '',
      lines: [
        {
          id: 'credit-line-1',
          sourceInvoiceLineId: 'line-1',
          position: 1,
          code: '',
          description: 'Work',
          quantityHundredths: 100,
          unit: 'h',
          unitPriceCents: 10_000,
          vatRateBasisPoints: 2_550,
          priceInputMode: 'net' as const,
          discount: { type: 'none' as const },
          baseCents: 10_000,
          discountCents: 0,
          netCents: 10_000,
          vatCents: 2_550,
          grossCents: 12_550,
        },
      ],
      totals: {
        netTotalCents: 10_000,
        vatTotalCents: 2_550,
        grossTotalCents: 12_550,
        vatBreakdown: [
          {
            vatRateBasisPoints: 2_550,
            netCents: 10_000,
            vatCents: 2_550,
            grossCents: 12_550,
          },
        ],
      },
      createdAt: '2026-07-23T09:00:00.000Z',
      updatedAt: '2026-07-23T09:00:00.000Z',
    };
    const createCreditDraft = vi.fn<
      InvoiceCreditDraftRepository['createCreditDraft']
    >(async () => ({
      outcome: 'existing',
      draftId: existingDraft.id,
    }));
    const dependencies = createDependencies({
      invoice,
      createCreditDraft,
      getDraftById: vi.fn(async () => existingDraft),
    });

    const result = await createCreditInvoiceDraft(
      createInput(),
      dependencies,
    );

    expect(result.id).toBe(existingDraft.id);
    expect(result.creditedInvoiceNumber).toBe('20260001');
    expect(createCreditDraft).toHaveBeenCalledOnce();
  });
});

function createInput(
  overrides: Partial<CreateCreditInvoiceDraftInput> = {},
): CreateCreditInvoiceDraftInput {
  return {
    actorContext: createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'company-1',
      permissions: ['manageInvoiceCorrections'],
    }),
    createdAt: '2026-07-23T10:00:00.000Z',
    invoiceId: 'invoice-1',
    ...overrides,
  };
}

function createDependencies(options: {
  invoice?: ApprovedInvoiceView;
  getApprovedInvoiceById?: ApprovedInvoiceReader['getApprovedInvoiceById'];
  createCreditDraft?: InvoiceCreditDraftRepository['createCreditDraft'];
  getDraftById?: InvoiceDraftRepository['getDraftById'];
} = {}): CreateCreditInvoiceDraftDependencies {
  return {
    approvedInvoiceReader: {
      getApprovedInvoiceById:
        options.getApprovedInvoiceById ??
        vi.fn(async () => options.invoice ?? createInvoice()),
      listApprovedInvoiceSummaries: vi.fn(async () => ({
        invoices: [],
        totalCount: 0,
      })),
    },
    invoiceCreditDraftRepository: {
      createCreditDraft:
        options.createCreditDraft ??
        vi.fn(async (input) => ({
          outcome: 'created' as const,
          draftId: input.draft.id,
        })),
      listPreviousCreditLineAllocations: vi.fn(async () => []),
    },
    invoiceDraftRepository: {
      deleteDraft: vi.fn(),
      saveDraft: vi.fn(),
      updateDraft: vi.fn(),
      getDraftById:
        options.getDraftById ??
        vi.fn(async () => undefined),
      listDraftSummaries: vi.fn(),
    },
  };
}

function createInvoice(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'company-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    invoiceNumber: '20260001',
    invoiceDate: '2026-07-01',
    status: 'sent',
    customerId: 'customer-1',
    billingRecipientCustomerId: null,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    taxTreatmentLabelSnapshot: '',
    taxLegalBasisSnapshot: '',
    performancePeriod: { type: 'invoiceDate' },
    subject: '',
    note: '',
    orderNumber: '',
    deliveryAddressText: '',
    lines: [
      {
        id: 'line-1',
        sourceInvoiceLineId: null,
        lineOrder: 1,
        code: '',
        description: 'Work',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2_550,
        discount: { type: 'none' },
        baseCents: 10_000,
        discountCents: 0,
        netCents: 10_000,
        vatCents: 2_550,
        grossCents: 12_550,
      },
    ],
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    customerBusinessIdSnapshot: '',
    customerTypeSnapshot: 'company',
    customerEmailSnapshot: '',
    customerPhoneSnapshot: '',
    customerStreetAddressSnapshot: '',
    customerPostalCodeSnapshot: '',
    customerCitySnapshot: '',
    billingRecipientCustomerNumberSnapshot: '',
    billingRecipientNameSnapshot: 'Example Customer Oy',
    billingRecipientBusinessIdSnapshot: '',
    billingRecipientCustomerTypeSnapshot: 'company',
    billingRecipientEmailSnapshot: '',
    billingRecipientPhoneSnapshot: '',
    billingRecipientStreetAddressSnapshot: '',
    billingRecipientPostalCodeSnapshot: '',
    billingRecipientCitySnapshot: '',
    totals: {
      netTotalCents: 10_000,
      vatTotalCents: 2_550,
      grossTotalCents: 12_550,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2_550,
          netCents: 10_000,
          vatCents: 2_550,
          grossCents: 12_550,
        },
      ],
    },
    ...overrides,
  } as ApprovedInvoiceView;
}
