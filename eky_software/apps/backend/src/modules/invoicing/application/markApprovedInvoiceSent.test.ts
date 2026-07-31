import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import {
  markApprovedInvoiceSent,
  type MarkApprovedInvoiceSentInput,
} from './markApprovedInvoiceSent.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';

describe('markApprovedInvoiceSent', () => {
  it('ensures the PDF and atomically records a bounded manual delivery', async () => {
    const approvedInvoice = createApprovedInvoiceView({ status: 'approved' });
    const sentInvoice = createApprovedInvoiceView({ status: 'sent' });
    const getApprovedInvoiceById = vi.fn(async () => approvedInvoice);
    const ensureApprovedInvoicePdfDocument = vi.fn(async () =>
      createDocumentMetadata(),
    );
    const completeManualDelivery = vi.fn(async () => ({
      updatedAt: sentInvoice.updatedAt,
    }));

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: {
          getApprovedInvoiceById,
          listApprovedInvoiceSummaries: vi.fn(),
        },
        ensureApprovedInvoicePdfDocument,
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).resolves.toStrictEqual(sentInvoice);

    expect(ensureApprovedInvoicePdfDocument).toHaveBeenCalledWith({
      companyId: 'dev-company',
      createdAt: '2026-07-08T10:00:00.000Z',
      invoiceId: 'invoice-1',
    });
    expect(completeManualDelivery).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      auditEventId: expectUuid(),
      companyId: 'dev-company',
      deliveredAt: '2026-07-08T10:00:00.000Z',
      deliveryEventId: expectUuid(),
      deliveryMethod: 'print',
      documentId: 'document-1',
      invoiceId: 'invoice-1',
    });
    expect(getApprovedInvoiceById).toHaveBeenCalledOnce();
  });

  it('does not finalize manual delivery when PDF ensuring fails', async () => {
    const completeManualDelivery = vi.fn();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'approved' }),
        ),
        ensureApprovedInvoicePdfDocument: vi.fn(async () => {
          throw new Error('PDF could not be generated.');
        }),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toThrow('PDF could not be generated.');

    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('does not create another event for an invoice already marked sent', async () => {
    const ensureApprovedInvoicePdfDocument = vi.fn();
    const completeManualDelivery = vi.fn();
    const sentInvoice = createApprovedInvoiceView({ status: 'sent' });

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(sentInvoice),
        ensureApprovedInvoicePdfDocument,
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).resolves.toStrictEqual(sentInvoice);

    expect(ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('throws a generic not-found error without invoking persistence', async () => {
    const completeManualDelivery = vi.fn();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(undefined),
        ensureApprovedInvoicePdfDocument: vi.fn(),
        invoiceDeliveryEventReader: createDeliveryEventReader(false),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('rejects a cancelled invoice before delivery state, PDF, or finalization', async () => {
    const invoiceDeliveryEventReader = createDeliveryEventReader(false);
    const ensureApprovedInvoicePdfDocument = vi.fn();
    const completeManualDelivery = vi.fn();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'cancelled' }),
        ),
        ensureApprovedInvoicePdfDocument,
        invoiceDeliveryEventReader,
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(
      invoiceDeliveryEventReader.hasUnresolvedDeliveryEvent,
    ).not.toHaveBeenCalled();
    expect(ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(completeManualDelivery).not.toHaveBeenCalled();
  });

  it('rejects missing permission before reading invoice data', async () => {
    const getApprovedInvoiceById = vi.fn();

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
          ensureApprovedInvoicePdfDocument: vi.fn(),
          invoiceDeliveryEventReader: createDeliveryEventReader(false),
          invoiceManualDeliveryFinalizer: {
            completeManualDelivery: vi.fn(),
          },
        },
      ),
    ).rejects.toThrow('Permission denied');

    expect(getApprovedInvoiceById).not.toHaveBeenCalled();
  });

  it('blocks manual delivery while an earlier delivery attempt is unresolved', async () => {
    const ensureApprovedInvoicePdfDocument = vi.fn();
    const completeManualDelivery = vi.fn();

    await expect(
      markApprovedInvoiceSent(createInput(), {
        approvedInvoiceReader: createReader(
          createApprovedInvoiceView({ status: 'approved' }),
        ),
        ensureApprovedInvoicePdfDocument,
        invoiceDeliveryEventReader: createDeliveryEventReader(true),
        invoiceManualDeliveryFinalizer: { completeManualDelivery },
      }),
    ).rejects.toEqual(new InvoiceDeliveryConflictError());

    expect(ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(completeManualDelivery).not.toHaveBeenCalled();
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

function createDeliveryEventReader(hasUnresolvedEvent: boolean) {
  return {
    hasUnresolvedDeliveryEvent: vi.fn(async () => hasUnresolvedEvent),
    listDeliveryEvents: vi.fn(async () => []),
  };
}

function createDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
  return {
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
