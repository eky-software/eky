import type { ApprovedInvoiceView } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoicePreview } from './ApprovedInvoicePreview.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoicePreview', () => {
  it('renders approved invoice snapshot details', () => {
    const longEmail =
      'billing.with.a.very.long.address.for.preview.testing@example-builder-company.test';
    const html = renderPreview({
      invoice: {
        ...createApprovedInvoiceView(),
        companyEmailSnapshot: longEmail,
      },
    });

    expect(html).toContain('Lasku 20260001');
    expect(html).toContain(uiText.invoicing.statusApproved);
    expect(html).toContain('Example Builder Oy');
    expect(html).toContain(uiText.companySettings.vatNumber);
    expect(html).toContain(uiText.companySettings.streetAddress);
    expect(html).toContain(longEmail);
    expect(html).toContain('www.example-builder.fi');
    expect(html).toContain('FI76543210');
    expect(html).toContain('Example Customer Oy');
    expect(html).toContain('Billing Recipient Oy');
    expect(html).toContain('202600017');
    expect(html).toContain('Work row');
    expect(html).toContain('25,50 %');
    expect(html).toContain('125,50');
    expect(html).toContain('FI21 1234 5600 0007 85');
    expect(html).toContain('NDEAFIHH');
  });

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

  it('renders clear VAT breakdown and payment details', () => {
    const html = renderPreview();

    expect(html).toContain(uiText.invoicing.rowVat);
    expect(html).toContain(uiText.invoicing.netAmount);
    expect(html).toContain(uiText.invoicing.vatAmount);
    expect(html).toContain(uiText.invoicing.grossTotal);
    expect(html).toContain(uiText.invoicing.paymentDetails);
    expect(html).toContain(uiText.invoicing.referenceNumber);
    expect(html).toContain(uiText.invoicing.dueDate);
    expect(html).toContain(uiText.invoicing.total);
  });

  it('hides empty optional invoice fields', () => {
    const html = renderPreview({
      invoice: {
        ...createApprovedInvoiceView(),
        deliveryAddressText: '',
        note: '',
        orderNumber: '',
        subject: '',
      },
    });

    expect(html).not.toContain(`${uiText.invoicing.deliveryAddressText}:`);
    expect(html).not.toContain(`${uiText.invoicing.note}:`);
    expect(html).not.toContain(`${uiText.invoicing.orderNumber}:`);
    expect(html).not.toContain(`${uiText.invoicing.subject}:`);
  });

  it('renders the edit action for approved invoices', () => {
    const html = renderPreview();

    expect(html).toContain(uiText.invoicing.editApprovedInvoice);
    expect(html).toContain(uiText.invoicing.markApprovedInvoiceSent);
  });

  it('renders sent status and hides editing actions for sent invoices', () => {
    const html = renderPreview({
      invoice: createApprovedInvoiceView({ status: 'sent' }),
    });

    expect(html).toContain(uiText.invoicing.statusSent);
    expect(html).not.toContain(uiText.invoicing.editApprovedInvoice);
    expect(html).not.toContain(uiText.invoicing.markApprovedInvoiceSent);
  });

  it('shows the PDF create action only when the stored PDF is not available', () => {
    const html = renderPreview({ isPdfAvailable: false });

    expect(html).toContain(uiText.invoicing.approvedInvoicePdfCreate);
    expect(html).not.toContain(uiText.invoicing.approvedInvoiceOpenPdf);
  });

  it('shows the PDF open action only when the stored PDF is available', () => {
    const html = renderPreview({ isPdfAvailable: true });

    expect(html).toContain(uiText.invoicing.approvedInvoiceOpenPdf);
    expect(html).toContain('secondary-action');
    expect(html).not.toContain(uiText.invoicing.approvedInvoicePdfCreate);
  });
});

function renderPreview(
  options: {
    invoice?: ApprovedInvoiceView;
    isPdfAvailable?: boolean;
    pdfErrorMessage?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <ApprovedInvoicePreview
      invoice={options.invoice ?? createApprovedInvoiceView()}
      isCreatingPdf={false}
      isMarkingSent={false}
      isPdfAvailable={options.isPdfAvailable ?? false}
      isReopening={false}
      markSentErrorMessage={null}
      pdfErrorMessage={options.pdfErrorMessage ?? null}
      reopenErrorMessage={null}
      onBack={vi.fn()}
      onCreatePdf={vi.fn()}
      onEditInvoice={vi.fn()}
      onMarkSent={vi.fn()}
      onOpenPdf={vi.fn()}
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
