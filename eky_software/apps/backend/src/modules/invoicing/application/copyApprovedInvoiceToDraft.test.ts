import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  copyApprovedInvoiceToDraft,
  type CopyApprovedInvoiceToDraftInput,
} from './copyApprovedInvoiceToDraft.js';

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  constructor(private readonly invoice: ApprovedInvoiceView | undefined) {}

  async getApprovedInvoiceById(): Promise<ApprovedInvoiceView | undefined> {
    return this.invoice;
  }

  async listApprovedInvoiceSummaries(): Promise<ApprovedInvoiceSummary[]> {
    throw new Error('Not implemented in this copy test.');
  }
}

class FakeCustomerAccessReader implements CustomerAccessReader {
  readonly checks: Array<{ companyId: string; customerId: string }> = [];

  constructor(private readonly availableCustomerIds: readonly string[]) {}

  async belongsToCompany(customerId: string, companyId: string): Promise<boolean> {
    this.checks.push({ companyId, customerId });

    return this.availableCustomerIds.includes(customerId);
  }
}

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  savedDrafts: InvoiceDraft[] = [];

  async deleteDraft(): Promise<boolean> {
    throw new Error('Not implemented in this copy test.');
  }

  async getDraftById(): Promise<InvoiceDraft | undefined> {
    throw new Error('Not implemented in this copy test.');
  }

  async listDraftSummaries(): Promise<never[]> {
    throw new Error('Not implemented in this copy test.');
  }

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    this.savedDrafts.push(draft);

    return draft;
  }

  async updateDraft(): Promise<InvoiceDraft | undefined> {
    throw new Error('Not implemented in this copy test.');
  }
}

describe('copyApprovedInvoiceToDraft', () => {
  it('copies an approved invoice snapshot into a new draft without invoice number or reference data', async () => {
    const invoice = createApprovedInvoiceView();
    const customerAccessReader = new FakeCustomerAccessReader([
      'customer-1',
      'billing-1',
    ]);
    const invoiceDraftRepository = new FakeInvoiceDraftRepository();

    const draft = await copyApprovedInvoiceToDraft(createInput(), {
      approvedInvoiceReader: new FakeApprovedInvoiceReader(invoice),
      customerAccessReader,
      invoiceDraftRepository,
    });

    expect(draft).toMatchObject({
      billingRecipientCustomerId: 'billing-1',
      companyId: 'dev-company',
      customerId: 'customer-1',
      deliveryAddressText: 'Worksite Street 4',
      dueDate: '2026-07-22',
      invoiceDate: '2026-07-08',
      latePaymentInterestBasisPoints: 950,
      note: 'Invoice note',
      orderNumber: 'ORDER-1',
      paymentTermDays: 14,
      priceInputMode: 'net',
      reminderPeriodDays: 8,
      status: 'draft',
      subject: 'Copied invoice',
      totals: {
        grossTotalCents: 12550,
        netTotalCents: 10000,
        vatTotalCents: 2550,
      },
    });
    expect(draft.id).not.toBe(invoice.id);
    expect(draft.createdAt).toBe('2026-07-08T09:00:00.000Z');
    expect(draft.updatedAt).toBe('2026-07-08T09:00:00.000Z');
    expect(draft.lines).toEqual([
      expect.objectContaining({
        code: 'WORK',
        description: 'Work',
        discount: { type: 'none' },
        position: 1,
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatRateBasisPoints: 2550,
      }),
    ]);
    expect(invoiceDraftRepository.savedDrafts).toEqual([draft]);
    expect(customerAccessReader.checks).toEqual([
      { companyId: 'dev-company', customerId: 'customer-1' },
      { companyId: 'dev-company', customerId: 'billing-1' },
    ]);
  });

  it('throws a generic not-found error when the invoice is outside the company scope', async () => {
    await expect(
      copyApprovedInvoiceToDraft(createInput(), {
        approvedInvoiceReader: new FakeApprovedInvoiceReader(undefined),
        customerAccessReader: new FakeCustomerAccessReader([]),
        invoiceDraftRepository: new FakeInvoiceDraftRepository(),
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());
  });

  it('rejects copying when the source customer is no longer available', async () => {
    const invoiceDraftRepository = new FakeInvoiceDraftRepository();

    await expect(
      copyApprovedInvoiceToDraft(createInput(), {
        approvedInvoiceReader: new FakeApprovedInvoiceReader(
          createApprovedInvoiceView(),
        ),
        customerAccessReader: new FakeCustomerAccessReader([]),
        invoiceDraftRepository,
      }),
    ).rejects.toThrow('Customer is not available for invoicing.');
    expect(invoiceDraftRepository.savedDrafts).toEqual([]);
  });
});

function createInput(
  overrides: Partial<CopyApprovedInvoiceToDraftInput> = {},
): CopyApprovedInvoiceToDraftInput {
  return {
    companyId: 'dev-company',
    copiedAt: '2026-07-08T09:00:00.000Z',
    invoiceId: 'invoice-1',
    ...overrides,
  };
}

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCitySnapshot: 'Espoo',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    companyBankNameSnapshot: 'Example Bank',
    companyBicSnapshot: 'NDEAFIHH',
    companyBusinessIdSnapshot: '7654321-0',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyId: 'dev-company',
    companyNameSnapshot: 'Example Builder Oy',
    companyPhoneSnapshot: '03 123 4567',
    companyPostalCodeSnapshot: '33100',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyVatNumberSnapshot: 'FI76543210',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    createdAt: '2026-06-13T10:00:00.000Z',
    customerBusinessIdSnapshot: '1234567-8',
    customerCitySnapshot: 'Helsinki',
    customerEmailSnapshot: 'customer@example.fi',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    customerPhoneSnapshot: '040 111 2222',
    customerPostalCodeSnapshot: '00100',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerTypeSnapshot: 'company',
    deliveryAddressText: 'Worksite Street 4',
    dueDate: '2026-06-27',
    id: 'invoice-1',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: 'WORK',
        description: 'Work',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12550,
        id: 'line-1',
        lineOrder: 1,
        netCents: 10000,
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Invoice note',
    numberingMode: 'calendarYearSequence',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    priceInputMode: 'net',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    reminderPeriodDays: 8,
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    seriesKey: 'default',
    sourceDraftId: 'draft-1',
    status: 'sent',
    subject: 'Copied invoice',
    totals: {
      grossTotalCents: 12550,
      netTotalCents: 10000,
      vatBreakdown: [
        {
          grossCents: 12550,
          netCents: 10000,
          vatCents: 2550,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2550,
    },
    updatedAt: '2026-06-13T10:00:00.000Z',
    vatBreakdown: [
      {
        grossCents: 12550,
        netCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
  };
}
