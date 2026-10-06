import { createUnexpectedLegacyRevisionPromoter } from './prepareInvoiceDeliveryRevision.fixture.js';
import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import { createInvoiceRevisionPdfContentFixture } from './toInvoiceRevisionPdfContent.fixture.js';
import {
  markApprovedInvoiceSent,
  type MarkApprovedInvoiceSentInput,
} from './markApprovedInvoiceSent.js';
import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import type { InvoiceManualDeliveryFinalizer } from '../ports/invoiceManualDeliveryFinalizer.js';

describe('markApprovedInvoiceSent', () => {
  it.each(['manual', 'print'] as const)('ensures the PDF and atomically records a bounded %s delivery', async (deliveryMethod) => {
    const approvedInvoice = createApprovedInvoiceView({ status: 'approved' });
    const sentInvoice = createApprovedInvoiceView({
      status: 'sent',
      updatedAt: '2026-07-08T10:00:00.000Z',
    });
    const getApprovedInvoiceById = vi.fn(async () => approvedInvoice);
    const invoiceContentRevisionReader = createRevisionReader();
    const ensureInvoiceRevisionPdfDocument = vi.fn(async () =>
      createDocumentMetadata(),
    );
    const completeManualDelivery = vi.fn<
      InvoiceManualDeliveryFinalizer['completeManualDelivery']
    >().mockResolvedValue({
      outcome: 'completed',
      updatedAt: sentInvoice.updatedAt,
    });
    const queueDeliveredInvoiceArchiveTask = vi.fn(async () => undefined);

    await expect(
      markApprovedInvoiceSent(createInput({ deliveryMethod }), {
        approvedInvoiceReader: {
          getApprovedInvoiceById,
          listApprovedInvoiceSummaries: vi.fn(),
        },
        deliveredInvoiceArchiveQueueFailureReporter:
          createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: {
          queueDeliveredInvoiceArchiveTask,
        },
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument,
        invoiceContentRevisionReader,
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).resolves.toStrictEqual(sentInvoice);

    expect(ensureInvoiceRevisionPdfDocument).toHaveBeenCalledWith({
      key: { companyId: 'dev-company', invoiceId: 'invoice-1', revisionId: 'revision-1' },
      createdAt: '2026-07-08T10:00:00.000Z',
    });
    expect(completeManualDelivery).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      auditEventId: expectUuid(),
      deliveredAt: '2026-07-08T10:00:00.000Z',
      deliveryEventId: expectUuid(),
      deliveryMethod,
      target: {
        kind: 'revision',
        companyId: 'dev-company',
        invoiceId: 'invoice-1',
        revisionId: 'revision-1',
        documentId: 'document-1',
        sha256: '0'.repeat(64),
        sizeBytes: 2048,
      },
    });
    expect(getApprovedInvoiceById).toHaveBeenCalledOnce();
    expect(invoiceContentRevisionReader.getCurrentRevision).toHaveBeenCalledExactlyOnceWith({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
    expect(invoiceContentRevisionReader.getCurrentRevision.mock.invocationCallOrder[0])
      .toBeLessThan(getApprovedInvoiceById.mock.invocationCallOrder[0]!);
    expect(queueDeliveredInvoiceArchiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: '2026-07-08T10:00:00.000Z',
        deliveryEventId: completeManualDelivery.mock.calls[0]?.[0].deliveryEventId,
        documentId: 'document-1',
        expectedPdfSha256: '0'.repeat(64),
        expectedPdfSize: 2048,
        invoiceId: 'invoice-1',
        invoiceKind: 'standard',
        invoiceNumber: '20260001',
        taskId: expectUuid(),
      }),
    );
    expect(completeManualDelivery).toHaveBeenCalledOnce();
    expect(queueDeliveredInvoiceArchiveTask).toHaveBeenCalledOnce();
  });

  it('does not finalize manual delivery when PDF ensuring fails', async () => {
    const completeManualDelivery = vi.fn();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'approved' }),
        ),
        deliveredInvoiceArchiveQueueFailureReporter:
          createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: createArchiveTaskSink(),
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument: vi.fn(async () => {
          throw new Error('PDF could not be generated.');
        }),
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toThrow('PDF could not be generated.');

    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('does not create another event for an invoice already marked sent', async () => {
    const ensureInvoiceRevisionPdfDocument = vi.fn();
    const completeManualDelivery = vi.fn();
    const sentInvoice = createApprovedInvoiceView({ status: 'sent' });
    const archiveTaskSink = createArchiveTaskSink();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(sentInvoice),
        deliveredInvoiceArchiveQueueFailureReporter:
          createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: archiveTaskSink,
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument,
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).resolves.toStrictEqual(sentInvoice);

    expect(ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(completeManualDelivery).not.toHaveBeenCalled();
    expect(archiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
  });

  it('does not queue a phantom archive when the finalizer reports alreadySent', async () => {
    const sentInvoice = createApprovedInvoiceView({
      status: 'sent',
      updatedAt: '2026-07-08T09:59:00.000Z',
    });
    const completeManualDelivery = vi.fn<
      InvoiceManualDeliveryFinalizer['completeManualDelivery']
    >().mockResolvedValue({
      outcome: 'alreadySent',
      updatedAt: sentInvoice.updatedAt,
    });
    const archiveTaskSink = createArchiveTaskSink();
    const queueFailureReporter = createArchiveQueueFailureReporter();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'approved' }),
        ),
        deliveredInvoiceArchiveQueueFailureReporter: queueFailureReporter,
        deliveredInvoiceArchiveTaskSink: archiveTaskSink,
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument: vi.fn(async () => createDocumentMetadata()),
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).resolves.toStrictEqual(sentInvoice);

    expect(completeManualDelivery).toHaveBeenCalledOnce();
    expect(archiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
    expect(queueFailureReporter.reportQueueFailure).not.toHaveBeenCalled();
  });

  it.each([
    ['company', { companyId: 'other-company' }],
    ['invoice', { invoiceId: 'other-invoice' }],
  ] as const)('rejects a PDF from another %s before finalizing or archiving', async (_scope, overrides) => {
    const completeManualDelivery = vi.fn();
    const archiveTaskSink = createArchiveTaskSink();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(createApprovedInvoiceView()),
        deliveredInvoiceArchiveQueueFailureReporter: createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: archiveTaskSink,
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument: vi.fn(async () => ({
          ...createDocumentMetadata(),
          ...overrides,
        })),
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toEqual(new InvoiceDocumentIntegrityError());

    expect(completeManualDelivery).not.toHaveBeenCalled();
    expect(archiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
  });

  it('rejects a PDF from a newer revision without finalizing or archiving the older view', async () => {
    const approvedInvoiceReader = createReader(createApprovedInvoiceView());
    const invoiceContentRevisionReader = createRevisionReader();
    const completeManualDelivery = vi.fn();
    const archiveTaskSink = createArchiveTaskSink();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader,
        invoiceContentRevisionReader,
        deliveredInvoiceArchiveQueueFailureReporter: createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: archiveTaskSink,
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument: vi.fn(async () => ({
          ...createDocumentMetadata(),
          binding: { kind: 'revision' as const, revisionId: 'revision-2' },
        })),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toEqual(new InvoiceDocumentPublicationConflictError());

    expect(invoiceContentRevisionReader.getCurrentRevision).toHaveBeenCalledOnce();
    expect(invoiceContentRevisionReader.getCurrentRevision.mock.invocationCallOrder[0])
      .toBeLessThan(approvedInvoiceReader.getApprovedInvoiceById.mock.invocationCallOrder[0]!);
    expect(completeManualDelivery).not.toHaveBeenCalled();
    expect(archiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
  });

  it('does not archive when the finalizer no longer finds the invoice', async () => {
    const completeManualDelivery = vi.fn<
      InvoiceManualDeliveryFinalizer['completeManualDelivery']
    >().mockResolvedValue(undefined);
    const archiveTaskSink = createArchiveTaskSink();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(createApprovedInvoiceView()),
        deliveredInvoiceArchiveQueueFailureReporter: createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: archiveTaskSink,
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument: vi.fn(async () => createDocumentMetadata()),
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(completeManualDelivery).toHaveBeenCalledOnce();
    expect(archiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
  });

  it('does not archive when manual finalization conflicts', async () => {
    const error = new InvoiceDeliveryConflictError();
    const completeManualDelivery = vi.fn<
      InvoiceManualDeliveryFinalizer['completeManualDelivery']
    >().mockRejectedValue(error);
    const archiveTaskSink = createArchiveTaskSink();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(createApprovedInvoiceView()),
        deliveredInvoiceArchiveQueueFailureReporter: createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: archiveTaskSink,
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument: vi.fn(async () => createDocumentMetadata()),
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toBe(error);

    expect(completeManualDelivery).toHaveBeenCalledOnce();
    expect(archiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
  });

  it.each(['invoice', 'revision'] as const)('throws a generic not-found error for a missing %s without invoking persistence', async (missing) => {
    const completeManualDelivery = vi.fn();
    const invoiceContentRevisionReader = createRevisionReader();
    const ensureInvoiceRevisionPdfDocument = vi.fn();
    if (missing === 'revision') {
      invoiceContentRevisionReader.getCurrentRevision.mockResolvedValue(undefined);
    }

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          missing === 'invoice' ? undefined : createApprovedInvoiceView(),
        ),
        deliveredInvoiceArchiveQueueFailureReporter:
          createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: createArchiveTaskSink(),
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument,
        invoiceContentRevisionReader,
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('rejects a cancelled invoice before delivery state, PDF, or finalization', async () => {
    const invoiceDeliveryEventReader = createDeliveryEventReader(false);
    const ensureInvoiceRevisionPdfDocument = vi.fn();
    const completeManualDelivery = vi.fn();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'cancelled' }),
        ),
        deliveredInvoiceArchiveQueueFailureReporter:
          createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: createArchiveTaskSink(),
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument,
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader,
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(
      invoiceDeliveryEventReader.hasUnresolvedDeliveryEvent,
    ).not.toHaveBeenCalled();
    expect(ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('rejects missing permission before reading invoice data', async () => {
    const getApprovedInvoiceById = vi.fn();
    const invoiceContentRevisionReader = createRevisionReader();

    await expect(
      markApprovedInvoiceSent(
        createInput({
          actorContext: createActorContext({
            actorId: 'user-1',
            authenticationMode: 'local',
            companyId: 'dev-company',
            permissions: [],
          }),
        }),
        {
          approvedInvoiceReader: {
            getApprovedInvoiceById,
            listApprovedInvoiceSummaries: vi.fn(),
          },
          deliveredInvoiceArchiveQueueFailureReporter:
            createArchiveQueueFailureReporter(),
          deliveredInvoiceArchiveTaskSink: createArchiveTaskSink(),
          invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),          ensureInvoiceRevisionPdfDocument: vi.fn(),
          invoiceContentRevisionReader,
          invoiceDeliveryEventReader: createDeliveryEventReader(false),
          invoiceManualDeliveryFinalizer: {
            completeManualDelivery: vi.fn(),
          },
        },
      ),
    ).rejects.toThrow('Permission denied');

    expect(getApprovedInvoiceById).not.toHaveBeenCalled();
    expect(invoiceContentRevisionReader.getCurrentRevision).not.toHaveBeenCalled();
  });

  it('blocks manual delivery while an earlier delivery attempt is unresolved', async () => {
    const ensureInvoiceRevisionPdfDocument = vi.fn();
    const completeManualDelivery = vi.fn();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'approved' }),
        ),
        deliveredInvoiceArchiveQueueFailureReporter:
          createArchiveQueueFailureReporter(),
        deliveredInvoiceArchiveTaskSink: createArchiveTaskSink(),
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument,
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(true),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toEqual(new InvoiceDeliveryConflictError());

    expect(ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('keeps a successful manual delivery successful when local archival fails', async () => {
    const sentInvoice = createApprovedInvoiceView({ status: 'sent' });
    const queueFailureReporter = createArchiveQueueFailureReporter();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'approved' }),
        ),
        deliveredInvoiceArchiveQueueFailureReporter: queueFailureReporter,
        deliveredInvoiceArchiveTaskSink: {
          queueDeliveredInvoiceArchiveTask: vi.fn(async () => {
            throw new Error('local archive unavailable');
          }),
        },
        invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),        ensureInvoiceRevisionPdfDocument: vi.fn(async () =>
          createDocumentMetadata(),
        ),
        invoiceContentRevisionReader: createRevisionReader(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: {
          completeManualDelivery: vi.fn<
            InvoiceManualDeliveryFinalizer['completeManualDelivery']
          >().mockResolvedValue({
            outcome: 'completed',
            updatedAt: sentInvoice.updatedAt,
          }),
        },
      }),
    ).resolves.toStrictEqual(sentInvoice);
    expect(queueFailureReporter.reportQueueFailure).toHaveBeenCalledOnce();
  });
});

function createInput(
  overrides: Partial<MarkApprovedInvoiceSentInput> = {},
): MarkApprovedInvoiceSentInput {
  return {
    actorContext: createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'dev-company',
      permissions: ['sendInvoices'],
    }),
    deliveryMethod: 'print',
    invoiceId: 'invoice-1',
    markedSentAt: '2026-07-08T10:00:00.000Z',
    ...overrides,
  };
}

function createReader(invoice: ApprovedInvoiceView | undefined) {
  return {
    getApprovedInvoiceById: vi.fn(async () => invoice),
    listApprovedInvoiceSummaries: vi.fn(),
  };
}

function createRevisionReader() {
  const revision = createInvoiceRevisionPdfContentFixture();

  return {
    getCurrentRevision: vi.fn<
      InvoiceContentRevisionReader['getCurrentRevision']
    >().mockResolvedValue({
      ...revision,
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
      revisionId: 'revision-1',
      lines: revision.lines.map((line) => ({ ...line, invoiceId: 'invoice-1' })),
    }),
  };
}

function createDeliveryEventReader(hasUnresolvedEvent: boolean) {
  return {
    requiresLegacyDeliveryReview: vi.fn(async () => false),
    hasUnresolvedDeliveryEvent: vi.fn(async () => hasUnresolvedEvent),
    listDeliveryEvents: vi.fn(async () => []),
  };
}

function createArchiveTaskSink() {
  return {
    queueDeliveredInvoiceArchiveTask: vi.fn(async () => undefined),
  };
}

function createArchiveQueueFailureReporter() {
  return {
    reportQueueFailure: vi.fn(),
  };
}

function createDocumentMetadata(): RevisionInvoiceDocumentMetadata {
  return {
    binding: { kind: 'revision', revisionId: 'revision-1' },
    companyId: 'dev-company',
    createdAt: '2026-07-08T10:00:00.000Z',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    id: 'document-1',
    invoiceId: 'invoice-1',
    mimeType: 'application/pdf',
    sha256: '0'.repeat(64),
    sizeBytes: 2048,
    storagePath: 'dev-company/invoice-1/lasku-20260001.pdf',
  };
}

function expectUuid() {
  return expect.stringMatching(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
}

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
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
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 0,
    lines: [],
    note: '',
    numberingMode: 'calendarYearSequence',
    orderNumber: '',
    paymentTermDays: 14,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    taxTreatmentLabelSnapshot: '',
    taxLegalBasisSnapshot: '',
    performancePeriod: { type: 'invoiceDate' },
    refundIbanSnapshot: '',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    reminderPeriodDays: 0,
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    seriesKey: 'default',
    sourceDraftId: 'draft-1',
    status: 'approved',
    subject: '',
    totals: {
      grossTotalCents: 0,
      netTotalCents: 0,
      vatBreakdown: [],
      vatTotalCents: 0,
    },
    updatedAt: '2026-06-13T10:00:00.000Z',
    vatBreakdown: [],
    paymentState:
      overrides.invoiceKind === 'credit' ? 'notApplicable' : 'unpaid',
    paidOn: null,
    paidAmountCents: null,
    paymentSource: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    ...overrides,
  };
}
