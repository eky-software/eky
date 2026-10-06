import {
  createEkyApiClient, EkyApiError,
  type ApprovedInvoiceEmailPreview, type ApprovedInvoiceView,
} from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoicingPage } from './InvoicingPage.js';
import { InvoicingPageView } from './InvoicingPageView.js';

type PageViewProps = React.ComponentProps<typeof InvoicingPageView>;

// Capture the real page's callbacks without replacing its hooks or client calls.
vi.mock('./InvoicingPageView.js', () => ({
  InvoicingPageView: vi.fn(() => null),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('InvoicingPage delivery preparation ownership', () => {
  it('refreshes shared lists after a completed delivery without reopening a cleared selection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Unexpected request'));
    const apiClient = createEkyApiClient({ baseUrl: 'https://example.invalid', fetch });
    let complete!: (invoice: ApprovedInvoiceView) => void;
    const pending = new Promise<ApprovedInvoiceView>(resolve => { complete = resolve; });
    vi.spyOn(apiClient, 'markApprovedInvoiceSent').mockReturnValue(pending);
    vi.spyOn(apiClient, 'listInvoiceDrafts').mockResolvedValue([]);
    const list = vi.spyOn(apiClient, 'listApprovedInvoices').mockResolvedValue({
      invoices: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0,
    });
    vi.spyOn(apiClient, 'listSentInvoiceGroups').mockResolvedValue({
      groups: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0,
    });
    const metadata = vi.spyOn(apiClient, 'getApprovedInvoicePdfMetadata');
    const history = vi.spyOn(apiClient, 'listInvoiceDeliveryEvents');
    renderToStaticMarkup(<InvoicingPage apiClient={apiClient} navigationRequest={{ revision: 1, target: null }} />);
    const props = vi.mocked(InvoicingPageView).mock.calls.at(-1)![0];
    const replace = vi.spyOn(props.approvedInvoiceState, 'replaceApprovedInvoice');
    props.onMarkApprovedInvoiceSent('invoice-1');
    props.onBackToDrafts();
    expect(list).not.toHaveBeenCalled();
    complete(createSentInvoice());
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
    expect(metadata).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it.each(['desktop', 'browser'] as const)('opens historical PDFs via the exact %s event route without creating or sending', async (runtime) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Unexpected request'));
    const apiClient = createEkyApiClient({ baseUrl: 'https://example.invalid', fetch });
    const createPdf = vi.spyOn(apiClient, 'createApprovedInvoicePdf');
    const send = vi.spyOn(apiClient, 'sendApprovedInvoiceEmailSmtp');
    const previewWindow = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
    const open = vi.fn(() => previewWindow);
    vi.stubGlobal('window', { open });
    const native = vi.fn(async () => undefined);
    renderToStaticMarkup(<InvoicingPage
      apiClient={apiClient} navigationRequest={{ revision: 1, target: null }}
      {...(runtime === 'desktop' ? { openInvoicePdfPreview: native } : {})}
    />);
    const props = vi.mocked(InvoicingPageView).mock.calls.at(-1)![0];
    expect(await props.onOpenDeliveryEventPdf('invoice-1', 'event-old')).toBe(true);
    if (runtime === 'desktop') {
      expect(native).toHaveBeenCalledExactlyOnceWith('invoice-1', { kind: 'deliveryEvent', eventId: 'event-old' });
      expect(open).not.toHaveBeenCalled();
    } else {
      expect(previewWindow.location.href).toBe('https://example.invalid/invoices/invoice-1/delivery-events/event-old/pdf');
      expect(previewWindow.opener).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(createPdf).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('does not load the current PDF after preparing a preserved attachment', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Unexpected request'));
    const apiClient = createEkyApiClient({ baseUrl: 'https://example.invalid', fetch });
    const metadata = vi.spyOn(apiClient, 'getApprovedInvoicePdfMetadata');
    const createPdf = vi.spyOn(apiClient, 'createApprovedInvoicePdf');
    const prepared: ApprovedInvoiceEmailPreview = {
      attachment: { documentId: 'copy-2', fileName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 123 },
      documentTarget: { kind: 'preservedLegacy', documentId: 'copy-2' },
      body: 'Invoice attached.', invoiceId: 'invoice-1', invoiceNumber: '20260001',
      provider: 'dryRun', subject: 'Invoice', to: 'recipient@example.invalid',
    };
    const prepare = vi.spyOn(apiClient, 'prepareApprovedInvoiceEmailDryRun').mockResolvedValue(prepared);
    renderToStaticMarkup(<InvoicingPage apiClient={apiClient} navigationRequest={{ revision: 1, target: null }} />);
    const props = vi.mocked(InvoicingPageView).mock.calls.at(-1)![0];
    props.onPrepareApprovedInvoiceEmail('invoice-1');
    await prepare.mock.results[0]!.value;
    // Flush the hook completion and its caller without wall-clock sleeps.
    await Promise.resolve();
    await Promise.resolve();
    expect(metadata).not.toHaveBeenCalled();
    expect(createPdf).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['desktop', 'browser'] as const)('wires the preserved attachment to the exact %s preview without generation', async (runtime) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Unexpected request'));
    const apiClient = createEkyApiClient({ baseUrl: 'https://example.invalid', fetch });
    const createPdf = vi.spyOn(apiClient, 'createApprovedInvoicePdf');
    const previewWindow = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
    const open = vi.fn(() => previewWindow);
    vi.stubGlobal('window', { open });
    const native = vi.fn(async () => undefined);
    renderToStaticMarkup(<InvoicingPage
      apiClient={apiClient} navigationRequest={{ revision: 1, target: null }}
      {...(runtime === 'desktop' ? { openInvoicePdfPreview: native } : {})}
    />);
    const props = vi.mocked(InvoicingPageView).mock.calls.at(-1)![0];
    expect(await props.onOpenPreservedPdf('invoice-1', 'copy-2')).toBe(true);
    if (runtime === 'desktop') {
      expect(native).toHaveBeenCalledExactlyOnceWith('invoice-1', { kind: 'preservedLegacy', documentId: 'copy-2' });
      expect(open).not.toHaveBeenCalled();
    } else {
      expect(previewWindow.location.href).toBe('https://example.invalid/invoices/invoice-1/preserved-documents/copy-2/pdf');
      expect(previewWindow.opener).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(createPdf).not.toHaveBeenCalled();
  });
  it.each([
    {
      action: 'manual mark sent',
      method: 'markApprovedInvoiceSent' as const,
      args: ['legacy-invoice', 'manual'],
      invoke: (props: PageViewProps) => props.onMarkApprovedInvoiceSent('legacy-invoice'),
    },
    {
      action: 'prepare email',
      method: 'prepareApprovedInvoiceEmailDryRun' as const,
      args: ['legacy-invoice'],
      invoke: (props: PageViewProps) => props.onPrepareApprovedInvoiceEmail('legacy-invoice'),
    },
  ])('$action reaches the guarded command before any separate PDF request', async ({ method, args, invoke }) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Unexpected request'));
    const apiClient = createEkyApiClient({ baseUrl: 'https://example.invalid', fetch });
    const pdf = vi.spyOn(apiClient, 'createApprovedInvoicePdf')
      .mockRejectedValue(new Error('Legacy snapshots cannot be regenerated'));
    const metadata = vi.spyOn(apiClient, 'getApprovedInvoicePdfMetadata');
    const command = vi.spyOn(apiClient, method).mockRejectedValue(new EkyApiError(
      'Legacy invoice delivery history requires review before editing or sending.',
      { status: 409, responseBody: { code: 'INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED' } },
    ));

    renderToStaticMarkup(<InvoicingPage
      apiClient={apiClient}
      navigationRequest={{ revision: 1, target: null }}
    />);
    const props = vi.mocked(InvoicingPageView).mock.calls.at(-1)?.[0];
    expect(props).toBeDefined();
    if (props === undefined) throw new Error('Page view was not rendered');

    invoke(props);
    try {
      expect(command).toHaveBeenCalledExactlyOnceWith(...args);
      expect(pdf).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await Promise.allSettled([...pdf.mock.results, ...command.mock.results]
        .filter((result) => result.type === 'return')
        .map((result) => result.value));
    }
    expect(metadata).not.toHaveBeenCalled();
  });

  it.each(['manual', 'email'] as const)('%s success refreshes PDF metadata after the backend command', async (mode) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Unexpected request'));
    const apiClient = createEkyApiClient({ baseUrl: 'https://example.invalid', fetch });
    const pdf = vi.spyOn(apiClient, 'createApprovedInvoicePdf');
    const metadata = vi.spyOn(apiClient, 'getApprovedInvoicePdfMetadata');
    const metadataRead = new Promise<void>((resolve) => {
      metadata.mockImplementation(async () => {
        resolve();
        throw new EkyApiError('Metadata unavailable', { status: 404 });
      });
    });
    const markSent = vi.spyOn(apiClient, 'markApprovedInvoiceSent')
      .mockResolvedValue(createSentInvoice());
    const emailPreview: ApprovedInvoiceEmailPreview = {
      attachment: { documentId: 'document-1', fileName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 123 },
      documentTarget: { kind: 'revision', documentId: 'document-1' },
      body: 'Invoice attached.', invoiceId: 'invoice-1', invoiceNumber: '20260001',
      provider: 'dryRun', subject: 'Invoice', to: 'recipient@example.invalid',
    };
    const prepareEmail = vi.spyOn(apiClient, 'prepareApprovedInvoiceEmailDryRun')
      .mockResolvedValue(emailPreview);
    const approvedList = vi.spyOn(apiClient, 'listApprovedInvoices').mockResolvedValue({
      invoices: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0,
    });
    const sentGroups = vi.spyOn(apiClient, 'listSentInvoiceGroups').mockResolvedValue({
      groups: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0,
    });
    const deliveryEvents = vi.spyOn(apiClient, 'listInvoiceDeliveryEvents').mockResolvedValue([]);
    const creditContext = vi.spyOn(apiClient, 'getInvoiceCreditContext')
      .mockRejectedValue(new EkyApiError('Not found', { status: 404 }));

    renderToStaticMarkup(<InvoicingPage apiClient={apiClient} navigationRequest={{ revision: 1, target: null }} />);
    const props = vi.mocked(InvoicingPageView).mock.calls.at(-1)?.[0];
    if (props === undefined) throw new Error('Page view was not rendered');

    if (mode === 'manual') props.onMarkApprovedInvoiceSent('invoice-1');
    else props.onPrepareApprovedInvoiceEmail('invoice-1');

    await metadataRead;
    await Promise.allSettled([
      ...markSent.mock.results, ...prepareEmail.mock.results, ...metadata.mock.results,
      ...approvedList.mock.results, ...sentGroups.mock.results,
      ...deliveryEvents.mock.results, ...creditContext.mock.results,
    ].filter((result) => result.type === 'return').map((result) => result.value));
    const command = mode === 'manual' ? markSent : prepareEmail;
    expect(command).toHaveBeenCalledTimes(1);
    expect(metadata).toHaveBeenCalledExactlyOnceWith('invoice-1');
    expect(metadata.mock.invocationCallOrder[0]).toBeGreaterThan(command.mock.invocationCallOrder[0]!);
    expect(pdf).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(approvedList).toHaveBeenCalledTimes(mode === 'manual' ? 2 : 0);
    expect(sentGroups).toHaveBeenCalledTimes(mode === 'manual' ? 3 : 0);
    expect(deliveryEvents).toHaveBeenCalledTimes(mode === 'manual' ? 1 : 0);
  });
});

function createSentInvoice(): ApprovedInvoiceView {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '', billingRecipientCitySnapshot: '',
    billingRecipientCustomerId: null, billingRecipientCustomerNumberSnapshot: '',
    billingRecipientCustomerTypeSnapshot: '', billingRecipientEmailSnapshot: '',
    billingRecipientNameSnapshot: '', billingRecipientPhoneSnapshot: '',
    billingRecipientPostalCodeSnapshot: '', billingRecipientStreetAddressSnapshot: '',
    companyBankNameSnapshot: '', companyBicSnapshot: '', companyBusinessIdSnapshot: '',
    companyCitySnapshot: '', companyEmailSnapshot: '', companyIbanSnapshot: '',
    companyId: 'dev-company', companyNameSnapshot: '', companyPhoneSnapshot: '',
    companyPostalCodeSnapshot: '', companyStreetAddressSnapshot: '',
    companyVatNumberSnapshot: '', companyWebsiteSnapshot: '',
    createdAt: '2026-06-13T10:00:00.000Z',
    creditedInvoiceId: null, creditedInvoiceNumber: null, creditedInvoiceDate: null,
    customerBusinessIdSnapshot: '', customerCitySnapshot: '', customerEmailSnapshot: '',
    customerId: 'customer-1', customerNameSnapshot: '', customerNumberSnapshot: '',
    customerPhoneSnapshot: '', customerPostalCodeSnapshot: '', customerStreetAddressSnapshot: '',
    customerTypeSnapshot: '', deliveryAddressText: '', refundIbanSnapshot: '',
    dueDate: '2026-06-27', id: 'invoice-1', invoiceKind: 'standard',
    invoiceDate: '2026-06-13', invoiceNumber: '20260001', latePaymentInterestBasisPoints: 0,
    lines: [], note: '', numberingMode: 'calendarYearSequence', orderNumber: '',
    paymentTermDays: 14, priceInputMode: 'net', taxTreatment: 'normalVat',
    taxTreatmentLabelSnapshot: '', taxLegalBasisSnapshot: '',
    performancePeriod: { type: 'invoiceDate' }, referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic', reminderPeriodDays: 0,
    sequenceNumber: 1, sequenceScope: 'calendar-year:2026', seriesKey: 'default',
    sourceDraftId: 'draft-1', status: 'sent', subject: '',
    totals: { grossTotalCents: 0, netTotalCents: 0, vatBreakdown: [], vatTotalCents: 0 },
    updatedAt: '2026-06-13T10:00:00.000Z', paymentState: 'unpaid', paidOn: null,
    paidAmountCents: null, paymentSource: null, vatBreakdown: [],
    cancelledAt: null, cancelledBy: null, cancellationReason: null,
  };
}
