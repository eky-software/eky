import type {
  ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData,
  ApprovedInvoiceView,
  InvoiceDeliveryEventSummary,
} from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoicePreview } from './ApprovedInvoicePreview.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoicePreview', () => {
  it('renders invoice detail sections in a readable review order', () => {
    const html = renderPreview();

    expect(html.indexOf(uiText.invoicing.seller)).toBeLessThan(
      html.indexOf(uiText.invoicing.basicInformation),
    );
    expect(html.indexOf(uiText.invoicing.basicInformation)).toBeLessThan(
      html.indexOf(uiText.invoicing.customer),
    );
    expect(html.indexOf(uiText.invoicing.customer)).toBeLessThan(
      html.indexOf(uiText.invoicing.invoiceRecipient),
    );
  });

  it('renders the dry-run email preview without technical error details', () => {
    const html = renderPreview({
      email: createApprovedInvoiceEmailPreview(),
      emailErrorMessage: uiText.invoicing.invoiceEmailPrepareError,
    });

    expect(html).toContain(uiText.invoicing.invoiceEmailPreviewTitle);
    expect(html).toContain(uiText.invoicing.invoiceEmailDryRunBadge);
    expect(html).toContain(uiText.invoicing.invoiceEmailEditHelp);
    expect(html).toContain(uiText.invoicing.invoiceEmailToInput);
    expect(html).toContain(uiText.invoicing.invoiceEmailCc);
    expect(html).toContain(uiText.invoicing.invoiceEmailSubjectInput);
    expect(html).toContain(uiText.invoicing.invoiceEmailDryRunSend);
    expect(html).toContain(uiText.invoicing.invoiceEmailSmtpTestSend);
    expect(html).toContain(uiText.invoicing.invoiceEmailSmtpSend);
    expect(html).toContain(
      uiText.invoicing.invoiceEmailSmtpTestActualRecipient,
    );
    expect(html).toContain('safe-test@example.fi');
    expect(html).toContain('id="invoice-email-to"');
    expect(html).toContain('id="invoice-email-cc"');
    expect(html).toContain('id="invoice-email-subject"');
    expect(html).toContain('<textarea');
    expect(html).toContain('id="invoice-email-body"');
    expect(html).toContain('recipient@example.fi');
    expect(html).toContain('Lasku 20260001');
    expect(html).toContain('lasku-20260001.pdf');
    expect(html).not.toContain('type="file"');
    expect(html).toContain(uiText.invoicing.invoiceEmailPrepareError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders safe dry-run email send status messages', () => {
    const html = renderPreview({
      email: createApprovedInvoiceEmailPreview(),
      emailSendErrorMessage: uiText.invoicing.invoiceEmailDryRunSendError,
      emailSendSuccessMessage: uiText.invoicing.invoiceEmailDryRunSendSuccess,
    });

    expect(html).toContain(uiText.invoicing.invoiceEmailDryRunSendSuccess);
    expect(html).toContain(uiText.invoicing.invoiceEmailDryRunSendError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders one clear manual delivery action and safe delivery history', () => {
    const html = renderPreview({
      deliveryEvents: [
        {
          ccEmail: '',
          createdAt: '2026-07-20T20:00:00.000Z',
          deliveryMethod: 'print',
          id: 'event-1',
          provider: 'manual',
          recipientEmail: '',
          safeErrorMessage: null,
          status: 'succeeded',
        },
      ],
    });

    expect(html).toContain(uiText.invoicing.markApprovedInvoiceSent);
    expect(html).not.toContain('<select');
    expect(html).toContain(uiText.invoicing.invoiceDeliveryHistory);
    expect(html).toContain(uiText.invoicing.invoiceDeliveryStatuses.succeeded);
  });

  it('renders a credit invoice as a negative correction without payment details', () => {
    const html = renderPreview({
      invoice: createApprovedInvoiceView({
        creditedInvoiceId: 'source-invoice-1',
        creditedInvoiceNumber: '20260001',
        creditedInvoiceDate: '2026-06-01',
        invoiceKind: 'credit',
        invoiceNumber: '20260002',
        referenceNumber: '',
        referenceNumberType: 'none',
        dueDate: '2026-06-13',
        paymentTermDays: 0,
        reminderPeriodDays: 0,
        latePaymentInterestBasisPoints: 0,
        lines: [
          {
            ...createApprovedInvoiceView().lines[0]!,
            sourceInvoiceLineId: 'source-line-1',
          },
        ],
      }),
    });

    expect(html).toContain(uiText.invoicing.creditInvoice);
    expect(html).toContain(uiText.invoicing.creditedInvoiceNumber);
    expect(html).toContain('20260001');
    expect(html).toContain('−125,50');
    expect(html).not.toContain(uiText.invoicing.paymentDetails);
    expect(html).not.toContain(uiText.invoicing.referenceNumber);
    expect(html).not.toContain(uiText.invoicing.dueDate);
  });

  it('does not render raw delivery error details', () => {
    const html = renderPreview({
      deliveryEvents: [
        {
          ccEmail: 'copy@example.fi',
          createdAt: '2026-07-20T20:00:00.000Z',
          deliveryMethod: 'email',
          id: 'event-1',
          provider: 'smtp',
          recipientEmail: 'recipient@example.fi',
          safeErrorMessage: 'Raw provider details must not be rendered',
          status: 'outcomeUnknown',
        },
      ],
    });

    expect(html).toContain(
      uiText.invoicing.invoiceDeliveryHistoryOutcomeUnknown,
    );
    expect(html).not.toContain('Raw provider details');
  });
});

function renderPreview(
  options: {
    copyErrorMessage?: string | null;
    email?: ApprovedInvoiceEmailPreviewData | null;
    emailErrorMessage?: string | null;
    emailSendErrorMessage?: string | null;
    emailSendSuccessMessage?: string | null;
    deliveryEvents?: InvoiceDeliveryEventSummary[];
    invoice?: ApprovedInvoiceView;
    isCopyingInvoice?: boolean;
    isCreatingPdf?: boolean;
    isPdfAvailable?: boolean;
    pdfErrorMessage?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <ApprovedInvoicePreview
      cancellationErrorMessage={null}
      copyErrorMessage={options.copyErrorMessage ?? null}
      creditContext={null}
      creditContextErrorMessage={null}
      email={options.email ?? null}
      emailErrorMessage={options.emailErrorMessage ?? null}
      emailSendErrorMessage={options.emailSendErrorMessage ?? null}
      emailSendSuccessMessage={options.emailSendSuccessMessage ?? null}
      emailSmtpTestErrorMessage={null}
      emailSmtpTestRecipient="safe-test@example.fi"
      emailSmtpTestSuccessMessage={null}
      emailSmtpTestUnavailableMessage={null}
      emailSmtpErrorMessage={null}
      emailSmtpSuccessMessage={null}
      emailSmtpUnavailableMessage={null}
      deliveryEvents={options.deliveryEvents ?? []}
      deliveryEventsErrorMessage={null}
      invoice={options.invoice ?? createApprovedInvoiceView()}
      isCancellingInvoice={false}
      isCopyingInvoice={options.isCopyingInvoice ?? false}
      isCreatingPdf={options.isCreatingPdf ?? false}
      isLoadingCreditContext={false}
      isMarkingSent={false}
      isPreparingEmail={false}
      isSendingEmailDryRun={false}
      isSendingEmailSmtp={false}
      isSendingEmailSmtpTest={false}
      isLoadingDeliveryEvents={false}
      isPdfAvailable={options.isPdfAvailable ?? false}
      isReopening={false}
      markSentErrorMessage={null}
      pdfErrorMessage={options.pdfErrorMessage ?? null}
      reopenErrorMessage={null}
      onBack={vi.fn()}
      onCancelInvoice={vi.fn()}
      onCopyInvoice={vi.fn()}
      onCreateCreditDraft={vi.fn()}
      onCreatePdf={vi.fn()}
      onEditInvoice={vi.fn()}
      onMarkSent={vi.fn()}
      onOpenPdf={vi.fn()}
      onOpenRelatedDraft={vi.fn()}
      onOpenRelatedInvoice={vi.fn()}
      onPrepareEmail={vi.fn()}
      onSendEmailDryRun={vi.fn()}
      onSendEmailSmtp={vi.fn()}
      onSendEmailSmtpTest={vi.fn()}
    />,
  );
}

function createApprovedInvoiceEmailPreview(): ApprovedInvoiceEmailPreviewData {
  return {
    attachment: {
      documentId: 'document-1',
      fileName: 'lasku-20260001.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
    },
    body: 'Hei,\n\nLiitteenä lasku 20260001.',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    provider: 'dryRun',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
  };
}

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCitySnapshot: 'Espoo',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientPhoneSnapshot: '',
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
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    customerBusinessIdSnapshot: '1234567-8',
    customerCitySnapshot: 'Helsinki',
    customerEmailSnapshot: '',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    customerPhoneSnapshot: '',
    customerPostalCodeSnapshot: '00100',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerTypeSnapshot: 'company',
    deliveryAddressText: 'Worksite Street 4',
    dueDate: '2026-06-27',
    id: 'invoice-1',
    invoiceKind: 'standard',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: 'WORK',
        description: 'Work row',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12550,
        id: 'line-1',
        sourceInvoiceLineId: null,
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
    status: 'approved',
    subject: 'Approved invoice',
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
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    vatBreakdown: [
      {
        grossCents: 12550,
        netCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    ...overrides,
  };
}
