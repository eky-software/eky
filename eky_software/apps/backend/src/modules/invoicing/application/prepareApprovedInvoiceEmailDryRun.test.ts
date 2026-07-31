import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceEmailDeliveryProvider } from '../ports/invoiceEmailDeliveryProvider.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { prepareApprovedInvoiceEmailDryRun } from './prepareApprovedInvoiceEmailDryRun.js';

describe('prepareApprovedInvoiceEmailDryRun', () => {
  it('prepares a dry-run invoice email from approved invoice snapshot data', async () => {
    const invoice = createApprovedInvoiceView();
    const document = createApprovedInvoiceDocumentMetadata();
    const approvedInvoiceReader = createApprovedInvoiceReader(invoice);
    const ensureApprovedInvoicePdfDocument = vi.fn(async () => document);
    const invoiceEmailDeliveryProvider = createDryRunProvider();

    const result = await prepareApprovedInvoiceEmailDryRun(
      {
        actorContext: createSendInvoicesActorContext(),
        invoiceId: 'invoice-1',
        preparedAt: '2026-07-09T10:00:00.000Z',
      },
      {
        approvedInvoiceReader,
        ensureApprovedInvoicePdfDocument,
        invoiceEmailDeliveryProvider,
      },
    );

    expect(approvedInvoiceReader.getApprovedInvoiceById).toHaveBeenCalledWith(
      'company-1',
      'invoice-1',
    );
    expect(ensureApprovedInvoicePdfDocument).toHaveBeenCalledWith({
      companyId: 'company-1',
      createdAt: '2026-07-09T10:00:00.000Z',
      invoiceId: 'invoice-1',
    });
    expect(invoiceEmailDeliveryProvider.prepareDryRunEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: {
          documentId: 'document-1',
          fileName: 'lasku-20260001.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        },
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        provider: 'dryRun',
        subject: 'Lasku 20260001',
        to: 'recipient@example.fi',
      }),
    );
    expect(result.body).toContain('Liitteenä lasku 20260001.');
    expect(result.body).toContain('Eräpäivä: 23.07.2026');
    expect(result.body).toContain('Maksun saaja: Example Builder Oy');
    expect(result.body).toContain('Viitenumero: 202600017');
    expect(result.body).toContain('Tilinumero: FI21 1234 5600 0007 85');
    expect(result.body).toContain('Summa: 1 255,00 EUR');
    expect(result.body.indexOf('Maksun saaja:')).toBeLessThan(
      result.body.indexOf('Viitenumero:'),
    );
  });

  it('falls back to customer email when billing recipient email is empty', async () => {
    const invoice = createApprovedInvoiceView({
      billingRecipientEmailSnapshot: '',
      customerEmailSnapshot: 'customer@example.fi',
    });
    const invoiceEmailDeliveryProvider = createDryRunProvider();

    const result = await prepareApprovedInvoiceEmailDryRun(
      {
        actorContext: createSendInvoicesActorContext(),
        invoiceId: 'invoice-1',
        preparedAt: '2026-07-09T10:00:00.000Z',
      },
      {
        approvedInvoiceReader: createApprovedInvoiceReader(invoice),
        ensureApprovedInvoicePdfDocument: vi.fn(
          async () => createApprovedInvoiceDocumentMetadata(),
        ),
        invoiceEmailDeliveryProvider,
      },
    );

    expect(result.to).toBe('customer@example.fi');
  });

  it('prepares a credit invoice email without a payment request', async () => {
    const invoice = createApprovedInvoiceView({
      creditedInvoiceId: 'source-invoice-1',
      creditedInvoiceNumber: '20260001',
      creditedInvoiceDate: '2026-07-01',
      invoiceKind: 'credit',
      invoiceNumber: '20260002',
      referenceNumber: '',
      referenceNumberType: 'none',
      dueDate: '2026-07-09',
      paymentTermDays: 0,
      reminderPeriodDays: 0,
      latePaymentInterestBasisPoints: 0,
    });
    const invoiceEmailDeliveryProvider = createDryRunProvider();

    const result = await prepareApprovedInvoiceEmailDryRun(
      {
        actorContext: createSendInvoicesActorContext(),
        invoiceId: 'invoice-1',
        preparedAt: '2026-07-09T10:00:00.000Z',
      },
      {
        approvedInvoiceReader: createApprovedInvoiceReader(invoice),
        ensureApprovedInvoicePdfDocument: vi.fn(async () => ({
          ...createApprovedInvoiceDocumentMetadata(),
          fileName: 'hyvityslasku-20260002.pdf',
        })),
        invoiceEmailDeliveryProvider,
      },
    );

    expect(result.subject).toBe('Hyvityslasku 20260002');
    expect(result.body).toContain('Liitteenä hyvityslasku 20260002.');
    expect(result.body).toContain(
      'Hyvityslasku kohdistuu laskuun 20260001 (01.07.2026).',
    );
    expect(result.body).toContain('Hyvityksen summa: -1 255,00 EUR');
    expect(result.body).not.toContain('Eräpäivä:');
    expect(result.body).not.toContain('Maksun saaja:');
    expect(result.body).not.toContain('Viitenumero:');
    expect(result.body).not.toContain('Tilinumero:');
  });

  it('does not prepare an email when the approved invoice is not found', async () => {
    const invoiceEmailDeliveryProvider = createDryRunProvider();

    await expect(
      prepareApprovedInvoiceEmailDryRun(
        {
          actorContext: createSendInvoicesActorContext(),
          invoiceId: 'missing-invoice',
          preparedAt: '2026-07-09T10:00:00.000Z',
        },
        {
          approvedInvoiceReader: createApprovedInvoiceReader(undefined),
          ensureApprovedInvoicePdfDocument: vi.fn(
            async () => createApprovedInvoiceDocumentMetadata(),
          ),
          invoiceEmailDeliveryProvider,
        },
      ),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(invoiceEmailDeliveryProvider.prepareDryRunEmail).not.toHaveBeenCalled();
  });

  it('does not prepare a cancelled invoice or ensure its PDF', async () => {
    const ensureApprovedInvoicePdfDocument = vi.fn(
      async () => createApprovedInvoiceDocumentMetadata(),
    );
    const invoiceEmailDeliveryProvider = createDryRunProvider();

    await expect(
      prepareApprovedInvoiceEmailDryRun(
        {
          actorContext: createSendInvoicesActorContext(),
          invoiceId: 'invoice-1',
          preparedAt: '2026-07-09T10:00:00.000Z',
        },
        {
          approvedInvoiceReader: createApprovedInvoiceReader(
            createApprovedInvoiceView({ status: 'cancelled' }),
          ),
          ensureApprovedInvoicePdfDocument,
          invoiceEmailDeliveryProvider,
        },
      ),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(invoiceEmailDeliveryProvider.prepareDryRunEmail).not.toHaveBeenCalled();
  });

  it('denies preparation without sendInvoices permission', async () => {
    const approvedInvoiceReader = createApprovedInvoiceReader(
      createApprovedInvoiceView(),
    );

    await expect(
      prepareApprovedInvoiceEmailDryRun(
        {
          actorContext: createActorContext({
            actorId: 'local-user',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          }),
          invoiceId: 'invoice-1',
          preparedAt: '2026-07-09T10:00:00.000Z',
        },
        {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument: vi.fn(
            async () => createApprovedInvoiceDocumentMetadata(),
          ),
          invoiceEmailDeliveryProvider: createDryRunProvider(),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(approvedInvoiceReader.getApprovedInvoiceById).not.toHaveBeenCalled();
  });
});

function createSendInvoicesActorContext() {
  return createActorContext({
    actorId: 'local-user',
    authenticationMode: 'local',
    companyId: 'company-1',
    permissions: ['sendInvoices'],
  });
}

function createApprovedInvoiceReader(
  invoice: ApprovedInvoiceView | undefined,
): ApprovedInvoiceReader {
  return {
    getApprovedInvoiceById: vi.fn(async () => invoice),
    listApprovedInvoiceSummaries: vi.fn(async () => ({
      invoices: [],
      totalCount: 0,
    })),
  };
}

function createDryRunProvider(): InvoiceEmailDeliveryProvider {
  return {
    prepareDryRunEmail: vi.fn(async (email) => email),
    sendDryRunEmail: vi.fn(async () => ({
      provider: 'dryRun' as const,
      providerMessageId: null,
    })),
  };
}

function createApprovedInvoiceDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
  return {
    id: 'document-1',
    companyId: 'company-1',
    invoiceId: 'invoice-1',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    storagePath: 'company-1/invoice-1/approved-invoice.pdf',
    mimeType: 'application/pdf',
    sha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sizeBytes: 2048,
    createdAt: '2026-07-09T10:00:00.000Z',
  };
}

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'company-1',
    sourceDraftId: 'draft-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2026',
    sequenceNumber: 1,
    numberingMode: 'calendarYearSequence',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    customerBusinessIdSnapshot: '1234567-8',
    customerTypeSnapshot: 'company',
    customerEmailSnapshot: 'customer@example.fi',
    customerPhoneSnapshot: '040 111 2222',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerPostalCodeSnapshot: '00100',
    customerCitySnapshot: 'Helsinki',
    companyNameSnapshot: 'Example Builder Oy',
    companyBusinessIdSnapshot: '7654321-0',
    companyVatNumberSnapshot: 'FI76543210',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyPostalCodeSnapshot: '33100',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyPhoneSnapshot: '03 123 4567',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyBicSnapshot: 'NDEAFIHH',
    companyBankNameSnapshot: 'Example Bank',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientCitySnapshot: 'Espoo',
    invoiceDate: '2026-07-09',
    dueDate: '2026-07-23',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    taxTreatmentLabelSnapshot: '',
    taxLegalBasisSnapshot: '',
    performancePeriod: { type: 'invoiceDate' },
    refundIbanSnapshot: '',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Invoice note',
    deliveryAddressText: 'Worksite Street 4',
    lines: [
      {
        id: 'line-1',
        sourceInvoiceLineId: null,
        lineOrder: 1,
        code: 'WORK',
        description: 'Work',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 100000,
        vatRateBasisPoints: 2550,
        discount: { type: 'none' },
        baseCents: 100000,
        discountCents: 0,
        netCents: 100000,
        vatCents: 25500,
        grossCents: 125500,
      },
    ],
    totals: {
      netTotalCents: 100000,
      vatTotalCents: 25500,
      grossTotalCents: 125500,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 100000,
          vatCents: 25500,
          grossCents: 125500,
        },
      ],
    },
    vatBreakdown: [
      {
        vatRateBasisPoints: 2550,
        netCents: 100000,
        vatCents: 25500,
        grossCents: 125500,
      },
    ],
    createdAt: '2026-07-09T10:00:00.000Z',
    approvedAt: '2026-07-09T10:00:00.000Z',
    updatedAt: '2026-07-09T10:00:00.000Z',
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
