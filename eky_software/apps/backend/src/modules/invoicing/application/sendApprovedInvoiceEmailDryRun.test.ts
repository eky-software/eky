import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type {
  ApprovedInvoiceEmailDryRunSend,
} from './approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  sendApprovedInvoiceEmailDryRun,
  type SendApprovedInvoiceEmailDryRunInput,
} from './sendApprovedInvoiceEmailDryRun.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
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
  implements InvoiceDeliveryEventRepository
{
  events: InvoiceDeliveryEvent[] = [];

  async completeDeliveryEvent(): Promise<void> {}

  async saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent> {
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

    const result = await sendApprovedInvoiceEmailDryRun(
      createInput({
        body: ' Hei,\n\nLiitteenä muokattu viesti. ',
        cc: ' copy@example.fi ',
        subject: ' Lasku 20260001 - muokattu ',
        to: ' recipient@example.fi ',
      }),
      dependencies,
    );

    expect(dependencies.ensureApprovedInvoicePdfDocument).toHaveBeenCalledWith({
      companyId: 'dev-company',
      createdAt: '2026-07-10T10:00:00.000Z',
      invoiceId: 'invoice-1',
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

    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(dependencies.provider.sentEmails).toEqual([]);
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });

  it('does not send or record when the approved invoice is not found', async () => {
    const dependencies = createDependencies({ invoice: undefined });

    await expect(
      sendApprovedInvoiceEmailDryRun(createInput(), dependencies),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
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

    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
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
        safeErrorMessage: 'Invoice email dry-run failed.',
        status: 'failed',
        technicalErrorCode: 'Error',
      }),
    ]);
    expect(
      dependencies.deliveryEventRepository.events[0]?.safeErrorMessage,
    ).not.toContain('secret-value');
  });

  it('denies sending before reading invoice data without sendInvoices permission', async () => {
    const dependencies = createDependencies();

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
    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(dependencies.deliveryEventRepository.events).toEqual([]);
  });
});

function createDependencies(options: {
  invoice?: ApprovedInvoiceView | undefined;
  sendError?: Error;
} = {}) {
  const deliveryEventRepository = new FakeInvoiceDeliveryEventRepository();
  const provider = new FakeEmailDeliveryProvider(options.sendError);

  return {
    approvedInvoiceReader: new FakeApprovedInvoiceReader(
      'invoice' in options ? options.invoice : createApprovedInvoiceView(),
    ),
    deliveryEventRepository,
    ensureApprovedInvoicePdfDocument: vi.fn(
      async () => createApprovedInvoiceDocumentMetadata(),
    ),
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

function createApprovedInvoiceDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
  return {
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
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    ...overrides,
  };
}
