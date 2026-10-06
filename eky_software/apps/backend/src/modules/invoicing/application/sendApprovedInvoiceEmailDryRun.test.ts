import { createUnexpectedLegacyRevisionPromoter } from './prepareInvoiceDeliveryRevision.fixture.js';
import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type {
  ApprovedInvoiceEmailDryRunSend,
} from './approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import { createInvoiceRevisionPdfContentFixture } from './toInvoiceRevisionPdfContent.fixture.js';
import {
  sendApprovedInvoiceEmailDryRun,
  type SendApprovedInvoiceEmailDryRunInput,
} from './sendApprovedInvoiceEmailDryRun.js';
import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import type { InvoiceEmailDeliveryProvider } from '../ports/invoiceEmailDeliveryProvider.js';

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  constructor(private readonly invoice: ApprovedInvoiceView | undefined) {}

  async getApprovedInvoiceById(
    _companyId: string,
    _invoiceId: string,
  ): Promise<ApprovedInvoiceView | undefined> {
    return this.invoice;
  }

  async listApprovedInvoiceSummaries(): Promise<never> {
    throw new Error('Not implemented in this send dry-run test.');
  }
}

class FakeInvoiceDeliveryEventRepository
  implements Pick<InvoiceDeliveryEventRepository, 'saveDeliveryEvent'>
{
  events: InvoiceDryRunDeliveryEvent[] = [];

  async saveDeliveryEvent(
    event: InvoiceDryRunDeliveryEvent,
  ): Promise<InvoiceDryRunDeliveryEvent> {
    this.events.push(event);

    return event;
  }
}

class FakeEmailDeliveryProvider implements InvoiceEmailDeliveryProvider {
  preparedEmails: unknown[] = [];
  sentEmails: ApprovedInvoiceEmailDryRunSend[] = [];

  constructor(private readonly sendError?: Error) {}

  async prepareDryRunEmail(email: never): Promise<never> {
    this.preparedEmails.push(email);

    return email;
  }

  async sendDryRunEmail(
    email: ApprovedInvoiceEmailDryRunSend,
  ): Promise<{ provider: 'dryRun'; providerMessageId: string | null }> {
    this.sentEmails.push(email);

    if (this.sendError !== undefined) {
      throw this.sendError;
    }

    return {
      provider: 'dryRun',
      providerMessageId: '<dry-run@example.fi>',
    };
  }
}

describe('sendApprovedInvoiceEmailDryRun', () => {
  it('validates user-edited email fields, ensures the PDF, calls the provider, and records a delivery event', async () => {
    const dependencies = createDependencies();
    const getApprovedInvoiceById = vi.spyOn(
      dependencies.approvedInvoiceReader,
      'getApprovedInvoiceById',
    );

    const result = await sendApprovedInvoiceEmailDryRun(
      createInput({
        body: ' Hei,\n\nLiitteenä muokattu viesti. ',
        cc: ' copy@example.fi ',
        subject: ' Lasku 20260001 - muokattu ',
        to: ' recipient@example.fi ',
      }),
      dependencies,
    );

    expect(dependencies.invoiceContentRevisionReader.getCurrentRevision).toHaveBeenCalledExactlyOnceWith({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
    expect(dependencies.invoiceContentRevisionReader.getCurrentRevision.mock.invocationCallOrder[0])
      .toBeLessThan(getApprovedInvoiceById.mock.invocationCallOrder[0]!);
    expect(dependencies.ensureInvoiceRevisionPdfDocument).toHaveBeenCalledWith({
      key: { companyId: 'dev-company', invoiceId: 'invoice-1', revisionId: 'revision-1' },
      createdAt: '2026-07-10T10:00:00.000Z',
    });
    expect(dependencies.provider.sentEmails).toEqual([
      expect.objectContaining({
        attachment: {
          documentId: 'document-1',
          fileName: 'lasku-20260001.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        },
        body: 'Hei,\n\nLiitteenä muokattu viesti.',
        cc: 'copy@example.fi',
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        provider: 'dryRun',
        subject: 'Lasku 20260001 - muokattu',
        to: 'recipient@example.fi',
      }),
    ]);
    expect(dependencies.deliveryEventRepository.events).toEqual([
      expect.objectContaining({
        bodyPreview: 'Hei,\n\nLiitteenä muokattu viesti.',
        ccEmail: 'copy@example.fi',
        companyId: 'dev-company',
        createdAt: '2026-07-10T10:00:00.000Z',
        createdBy: 'dev-user',
        deliveryMethod: 'email',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
        provider: 'dryRun',
        providerMessageId: '<dry-run@example.fi>',
        recipientEmail: 'recipient@example.fi',
        status: 'succeeded',
        subject: 'Lasku 20260001 - muokattu',
        target: {
          kind: 'revision',
          companyId: 'dev-company',
          invoiceId: 'invoice-1',
          revisionId: 'revision-1',
          documentId: 'document-1',
          sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          sizeBytes: 2048,
        },
      }),
    ]);
    expect(result.deliveryEventId).toBe(
      dependencies.deliveryEventRepository.events[0]?.id,
    );
  });

  it('does not call the provider when recipient email is invalid', async () => {
    const dependencies = createDependencies();

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput({ to: 'not-an-email' }), dependencies),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);

    expect(dependencies.ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it('does not send or record when the approved invoice is not found', async () => {
    const dependencies = createDependencies({ invoice: undefined });

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(dependencies.ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it('does not send or record when the current revision is missing', async () => {
    const dependencies = createDependencies();
    dependencies.invoiceContentRevisionReader.getCurrentRevision.mockResolvedValue(undefined);

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(dependencies.ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it('does not send or record a cancelled invoice', async () => {
    const dependencies = createDependencies({
      invoice: createApprovedInvoiceView({ status: 'cancelled' }),
    });

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(dependencies.ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it.each([
    ['company', { companyId: 'other-company' }],
    ['invoice', { invoiceId: 'other-invoice' }],
  ] as const)('rejects a PDF from another %s before sending or recording', async (_scope, overrides) => {
    const dependencies = createDependencies();
    dependencies.ensureInvoiceRevisionPdfDocument.mockResolvedValue({
      ...createApprovedInvoiceDocumentMetadata(),
      ...overrides,
    });

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toEqual(new InvoiceDocumentIntegrityError());

    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.provider.preparedEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it('rejects a PDF from a newer revision without sending or recording the older view', async () => {
    const dependencies = createDependencies();
    const getApprovedInvoiceById = vi.spyOn(
      dependencies.approvedInvoiceReader,
      'getApprovedInvoiceById',
    );
    dependencies.ensureInvoiceRevisionPdfDocument.mockResolvedValue({
      ...createApprovedInvoiceDocumentMetadata(),
      binding: { kind: 'revision', revisionId: 'revision-2' },
    });

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toEqual(new InvoiceDocumentPublicationConflictError());

    expect(dependencies.invoiceContentRevisionReader.getCurrentRevision).toHaveBeenCalledOnce();
    expect(dependencies.invoiceContentRevisionReader.getCurrentRevision.mock.invocationCallOrder[0])
      .toBeLessThan(getApprovedInvoiceById.mock.invocationCallOrder[0]!);
    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it('does not send or record when PDF ensuring fails', async () => {
    const dependencies = createDependencies();
    const error = new Error('PDF could not be generated.');
    dependencies.ensureInvoiceRevisionPdfDocument.mockRejectedValue(error);

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toBe(error);

    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it('records a safe failed delivery event when dry-run provider fails', async () => {
    const dependencies = createDependencies({
      sendError: new Error('SMTP password was wrong: secret-value'),
    });

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toEqual(
      new ApprovedInvoiceEmailDeliveryError('Invoice email dry-run failed.'),
    );

    expect(dependencies.deliveryEventRepository.events).toEqual([
      expect.objectContaining({
        companyId: 'dev-company',
        invoiceId: 'invoice-1',
        documentId: 'document-1',
        deliveryMethod: 'email',
        provider: 'dryRun',
        safeErrorMessage: 'Invoice email dry-run failed.',
        status: 'failed',
        target: {
          kind: 'revision',
          companyId: 'dev-company',
          invoiceId: 'invoice-1',
          revisionId: 'revision-1',
          documentId: 'document-1',
          sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          sizeBytes: 2048,
        },
        technicalErrorCode: 'Error',
      }),
    ]);
    expect(
      dependencies.deliveryEventRepository.events[0]?.safeErrorMessage,
    ).not.toContain('secret-value');
    expect(JSON.stringify(dependencies.deliveryEventRepository.events)).not.toContain('secret-value');
  });

  it('denies sending before reading invoice data without sendInvoices permission', async () => {
    const dependencies = createDependencies();
    const getApprovedInvoiceById = vi.spyOn(
      dependencies.approvedInvoiceReader,
      'getApprovedInvoiceById',
    );

    await expect(
      sendApprovedInvoiceEmailDryRun(
        createInput({
          actorContext: createActorContext({
            actorId: 'dev-user',
            authenticationMode: 'local',
            companyId: 'dev-company',
            permissions: [],
          }),
        }),
        dependencies,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(getApprovedInvoiceById).not.toHaveBeenCalled();
    expect(dependencies.invoiceContentRevisionReader.getCurrentRevision).not.toHaveBeenCalled();
    expect(dependencies.ensureInvoiceRevisionPdfDocument).not.toHaveBeenCalled();
    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });
});

function createDependencies(options: {
  invoice?: ApprovedInvoiceView | undefined;
  sendError?: Error;
} = {}) {
  const deliveryEventRepository = new FakeInvoiceDeliveryEventRepository();
  const provider = new FakeEmailDeliveryProvider(options.sendError);
  const revision = createInvoiceRevisionPdfContentFixture();

  return {
    approvedInvoiceReader: new FakeApprovedInvoiceReader(
      'invoice' in options ? options.invoice : createApprovedInvoiceView(),
    ),
    deliveryEventRepository,
    invoiceLegacyRevisionPromoter: createUnexpectedLegacyRevisionPromoter(),    ensureInvoiceRevisionPdfDocument: vi.fn(
      async () => createApprovedInvoiceDocumentMetadata(),
    ),
    invoiceContentRevisionReader: {
      getCurrentRevision: vi.fn<
        InvoiceContentRevisionReader['getCurrentRevision']
      >().mockResolvedValue({
        ...revision,
        companyId: 'dev-company',
        invoiceId: 'invoice-1',
        revisionId: 'revision-1',
        lines: revision.lines.map((line) => ({ ...line, invoiceId: 'invoice-1' })),
      }),
    },
    invoiceDeliveryEventReader: { requiresLegacyDeliveryReview: vi.fn(async () => false) },
    invoiceDeliveryEventRepository: deliveryEventRepository,
    invoiceEmailDeliveryProvider: provider,
    provider,
  };
}

function createInput(
  overrides: Partial<SendApprovedInvoiceEmailDryRunInput> = {},
): SendApprovedInvoiceEmailDryRunInput {
  return {
    actorContext: createActorContext({
      actorId: 'dev-user',
      authenticationMode: 'local',
      companyId: 'dev-company',
      permissions: ['sendInvoices'],
    }),
    body: 'Hei,\n\nLiitteenä lasku.',
    invoiceId: 'invoice-1',
    sentAt: '2026-07-10T10:00:00.000Z',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
    ...overrides,
  };
}

function createApprovedInvoiceDocumentMetadata(): RevisionInvoiceDocumentMetadata {
  return {
    binding: { kind: 'revision', revisionId: 'revision-1' },
    companyId: 'dev-company',
    createdAt: '2026-07-10T10:00:00.000Z',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    id: 'document-1',
    invoiceId: 'invoice-1',
    mimeType: 'application/pdf',
    sha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sizeBytes: 2048,
    storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
  };
}

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    approvedAt: '2026-07-10T09:00:00.000Z',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    billingRecipientBusinessIdSnapshot: '',
    billingRecipientCitySnapshot: 'Espoo',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientPhoneSnapshot: '',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientStreetAddressSnapshot: 'Billing Street 1',
    companyBankNameSnapshot: 'Example Bank',
    companyBicSnapshot: 'NDEAFIHH',
    companyBusinessIdSnapshot: '7654321-0',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyId: 'dev-company',
    companyNameSnapshot: 'Example Builder Oy',
    companyPhoneSnapshot: '',
    companyPostalCodeSnapshot: '33100',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyVatNumberSnapshot: 'FI76543210',
    companyWebsiteSnapshot: '',
    createdAt: '2026-07-10T09:00:00.000Z',
    customerBusinessIdSnapshot: '',
    customerCitySnapshot: 'Helsinki',
    customerEmailSnapshot: 'customer@example.fi',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    customerPhoneSnapshot: '',
    customerPostalCodeSnapshot: '00100',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerTypeSnapshot: 'company',
    deliveryAddressText: '',
    dueDate: '2026-07-24',
    id: 'invoice-1',
    invoiceDate: '2026-07-10',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 950,
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
    reminderPeriodDays: 8,
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
    updatedAt: '2026-07-10T09:00:00.000Z',
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
