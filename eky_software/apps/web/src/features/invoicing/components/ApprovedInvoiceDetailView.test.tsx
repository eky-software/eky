import type { ApprovedInvoiceView } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceDetailView } from './ApprovedInvoiceDetailView.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoiceDetailView', () => {
  it('renders the loading state while an approved invoice is opening', () => {
    const html = renderDetail({
      invoiceState: {
        approvedInvoice: null,
        errorMessage: null,
        isLoading: true,
      },
    });

    expect(html).toContain(uiText.invoicing.approvedInvoiceLoading);
  });

  it('renders a safe open error without technical response data', () => {
    const html = renderDetail({
      invoiceState: {
        approvedInvoice: null,
        errorMessage: uiText.invoicing.approvedInvoiceLoadError,
        isLoading: false,
      },
    });

    expect(html).toContain(uiText.invoicing.approvedInvoiceLoadError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the empty detail prompt when no approved invoice is open', () => {
    const html = renderDetail();

    expect(html).toContain(uiText.invoicing.approvedInvoiceOpenPrompt);
    expect(html).toContain(uiText.invoicing.backToDrafts);
  });

  it('renders an approved invoice preview from snapshot data', () => {
    const html = renderDetail({
      invoiceState: {
        approvedInvoice: createApprovedInvoiceView(),
        errorMessage: null,
        isLoading: false,
      },
    });

    expect(html).toContain('Lasku 20260001');
    expect(html).toContain('202600017');
    expect(html).toContain('Example Builder Oy');
    expect(html).toContain('FI76543210');
    expect(html).toContain('Example Customer Oy');
    expect(html).toContain('Billing Recipient Oy');
    expect(html).toContain('Work row');
    expect(html).toContain('25,50 %');
    expect(html).toContain('125,50');
    expect(html).toContain(uiText.invoicing.approvedInvoicePdfCreate);
    expect(html).not.toContain(uiText.invoicing.approvedInvoiceOpenPdf);
  });

  it('renders safe action errors without technical response data', () => {
    const html = renderDetail({
      copyState: {
        errorMessage: uiText.invoicing.copyApprovedInvoiceError,
        isCopying: false,
      },
      invoiceState: {
        approvedInvoice: createApprovedInvoiceView({ status: 'sent' }),
        errorMessage: null,
        isLoading: false,
      },
      pdfState: {
        document: null,
        errorMessage: uiText.invoicing.approvedInvoicePdfError,
        isCreating: false,
      },
    });

    expect(html).toContain(uiText.invoicing.copyApprovedInvoiceError);
    expect(html).toContain(uiText.invoicing.approvedInvoicePdfError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });
});

type ApprovedInvoiceDetailViewProps = React.ComponentProps<
  typeof ApprovedInvoiceDetailView
>;

function renderDetail(
  overrides: Partial<ApprovedInvoiceDetailViewProps> = {},
): string {
  return renderToStaticMarkup(
    <ApprovedInvoiceDetailView
      cancellationState={{ errorMessage: null, isCancelling: false }}
      copyState={{ errorMessage: null, isCopying: false }}
      creditContextState={{
        creditContext: null,
        errorMessage: null,
        isLoading: false,
      }}
      deliveryHistoryState={{
        errorMessage: null,
        events: [],
        isLoading: false,
      }}
      emailState={{ email: null, errorMessage: null, isPreparing: false }}
      emailSendState={{
        errorMessage: null,
        isSending: false,
        successMessage: null,
      }}
      emailSmtpState={{
        errorMessage: null,
        isSending: false,
        successMessage: null,
      }}
      emailSmtpTestRecipient={null}
      emailSmtpTestState={{
        errorMessage: null,
        isSending: false,
        successMessage: null,
      }}
      emailSmtpTestUnavailableMessage={null}
      emailSmtpUnavailableMessage={null}
      invoiceState={{
        approvedInvoice: null,
        errorMessage: null,
        isLoading: false,
      }}
      markSentState={{ errorMessage: null, isMarkingSent: false }}
      pdfState={{ document: null, errorMessage: null, isCreating: false }}
      reopenState={{ errorMessage: null, isReopening: false }}
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
      {...overrides}
    />,
  );
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
    deliveryAddressText: '',
    dueDate: '2026-06-27',
    id: 'invoice-1',
    invoiceKind: 'standard',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: '',
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
    note: '',
    numberingMode: 'calendarYearSequence',
    orderNumber: '',
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
