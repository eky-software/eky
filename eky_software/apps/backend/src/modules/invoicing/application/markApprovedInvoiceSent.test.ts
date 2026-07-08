import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type {
  ApprovedInvoiceResult,
  ApproveInvoiceDraftPersistenceInput,
  InvoiceApprovalRepository,
  MarkApprovedInvoiceSentPersistenceInput,
  MarkApprovedInvoiceSentResult,
  ReopenApprovedInvoicePersistenceInput,
  ReopenedApprovedInvoiceResult,
} from '../ports/invoiceApprovalRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  markApprovedInvoiceSent,
  type MarkApprovedInvoiceSentInput,
} from './markApprovedInvoiceSent.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';

class FakeInvoiceApprovalRepository implements InvoiceApprovalRepository {
  markInputs: MarkApprovedInvoiceSentPersistenceInput[] = [];

  constructor(private readonly result: MarkApprovedInvoiceSentResult | undefined) {}

  async approveDraft(
    _input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined> {
    throw new Error('Not implemented in this mark-sent test.');
  }

  async markApprovedInvoiceSent(
    input: MarkApprovedInvoiceSentPersistenceInput,
  ): Promise<MarkApprovedInvoiceSentResult | undefined> {
    this.markInputs.push(input);

    return this.result;
  }

  async reopenApprovedInvoiceForEditing(
    _input: ReopenApprovedInvoicePersistenceInput,
  ): Promise<ReopenedApprovedInvoiceResult | undefined> {
    throw new Error('Not implemented in this mark-sent test.');
  }
}

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  constructor(private readonly invoice: ApprovedInvoiceView | undefined) {}

  async getApprovedInvoiceById(): Promise<ApprovedInvoiceView | undefined> {
    return this.invoice;
  }

  async listApprovedInvoiceSummaries(): Promise<ApprovedInvoiceSummary[]> {
    throw new Error('Not implemented in this mark-sent test.');
  }
}

class FakeApprovedInvoicePdfEnsurer {
  inputs: GenerateApprovedInvoicePdfDocumentInput[] = [];

  constructor(private readonly error?: Error) {}

  async ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<void> {
    this.inputs.push(input);

    if (this.error !== undefined) {
      throw this.error;
    }
  }
}

describe('markApprovedInvoiceSent', () => {
  it('ensures the approved invoice PDF before marking the invoice sent', async () => {
    const invoice = createApprovedInvoiceView();
    const repository = new FakeInvoiceApprovalRepository({
      invoiceId: 'invoice-1',
      status: 'sent',
    });
    const pdfEnsurer = new FakeApprovedInvoicePdfEnsurer();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: new FakeApprovedInvoiceReader(invoice),
        ensureApprovedInvoicePdfDocument: (input) =>
          pdfEnsurer.ensureApprovedInvoicePdfDocument(input),
        invoiceApprovalRepository: repository,
      }),
    ).resolves.toStrictEqual(invoice);

    expect(pdfEnsurer.inputs).toEqual([
      {
        companyId: 'dev-company',
        createdAt: '2026-07-08T10:00:00.000Z',
        invoiceId: 'invoice-1',
      },
    ]);
    expect(repository.markInputs).toEqual([
      {
        actorUserId: 'user-1',
        auditEventId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        companyId: 'dev-company',
        invoiceId: 'invoice-1',
        markedSentAt: '2026-07-08T10:00:00.000Z',
      },
    ]);
  });

  it('does not mark the invoice sent when PDF ensuring fails', async () => {
    const repository = new FakeInvoiceApprovalRepository({
      invoiceId: 'invoice-1',
      status: 'sent',
    });
    const pdfEnsurer = new FakeApprovedInvoicePdfEnsurer(
      new Error('PDF could not be generated.'),
    );

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: new FakeApprovedInvoiceReader(createApprovedInvoiceView()),
        ensureApprovedInvoicePdfDocument: (input) =>
          pdfEnsurer.ensureApprovedInvoicePdfDocument(input),
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toThrow('PDF could not be generated.');

    expect(repository.markInputs).toEqual([]);
  });

  it('throws a generic not-found error when the invoice cannot be marked sent', async () => {
    const repository = new FakeInvoiceApprovalRepository(undefined);
    const pdfEnsurer = new FakeApprovedInvoicePdfEnsurer();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: new FakeApprovedInvoiceReader(undefined),
        ensureApprovedInvoicePdfDocument: (input) =>
          pdfEnsurer.ensureApprovedInvoicePdfDocument(input),
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());
  });

  it('rejects invalid identifiers before calling the repository', async () => {
    const repository = new FakeInvoiceApprovalRepository({
      invoiceId: 'invoice-1',
      status: 'sent',
    });
    const pdfEnsurer = new FakeApprovedInvoicePdfEnsurer();

    await expect(
      markApprovedInvoiceSent(createInput({ invoiceId: '' }), {
        approvedInvoiceReader: new FakeApprovedInvoiceReader(createApprovedInvoiceView()),
        ensureApprovedInvoicePdfDocument: (input) =>
          pdfEnsurer.ensureApprovedInvoicePdfDocument(input),
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toThrow();

    expect(pdfEnsurer.inputs).toEqual([]);
    expect(repository.markInputs).toEqual([]);
  });
});

function createInput(
  overrides: Partial<MarkApprovedInvoiceSentInput> = {},
): MarkApprovedInvoiceSentInput {
  return {
    actorUserId: 'user-1',
    companyId: 'dev-company',
    invoiceId: 'invoice-1',
    markedSentAt: '2026-07-08T10:00:00.000Z',
    ...overrides,
  };
}

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '',
    billingRecipientCitySnapshot: '',
    billingRecipientCustomerId: null,
    billingRecipientCustomerNumberSnapshot: '',
    billingRecipientCustomerTypeSnapshot: '',
    billingRecipientEmailSnapshot: '',
    billingRecipientNameSnapshot: '',
    billingRecipientPhoneSnapshot: '',
    billingRecipientPostalCodeSnapshot: '',
    billingRecipientStreetAddressSnapshot: '',
    companyBankNameSnapshot: '',
    companyBicSnapshot: '',
    companyBusinessIdSnapshot: '',
    companyCitySnapshot: '',
    companyEmailSnapshot: '',
    companyIbanSnapshot: '',
    companyId: 'dev-company',
    companyNameSnapshot: '',
    companyPhoneSnapshot: '',
    companyPostalCodeSnapshot: '',
    companyStreetAddressSnapshot: '',
    companyVatNumberSnapshot: '',
    companyWebsiteSnapshot: '',
    createdAt: '2026-06-13T10:00:00.000Z',
    customerBusinessIdSnapshot: '',
    customerCitySnapshot: '',
    customerEmailSnapshot: '',
    customerId: 'customer-1',
    customerNameSnapshot: '',
    customerNumberSnapshot: '',
    customerPhoneSnapshot: '',
    customerPostalCodeSnapshot: '',
    customerStreetAddressSnapshot: '',
    customerTypeSnapshot: '',
    deliveryAddressText: '',
    dueDate: '2026-06-27',
    id: 'invoice-1',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 0,
    lines: [],
    note: '',
    numberingMode: 'calendarYearSequence',
    orderNumber: '',
    paymentTermDays: 14,
    priceInputMode: 'net',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    reminderPeriodDays: 0,
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    seriesKey: 'default',
    sourceDraftId: 'draft-1',
    status: 'sent',
    subject: '',
    totals: {
      grossTotalCents: 0,
      netTotalCents: 0,
      vatBreakdown: [],
      vatTotalCents: 0,
    },
    updatedAt: '2026-06-13T10:00:00.000Z',
    vatBreakdown: [],
  };
}
