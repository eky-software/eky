import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApprovedInvoiceFacts } from './ApprovedInvoiceFacts.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoiceFacts', () => {
  it('renders invoice facts and optional snapshot fields', () => {
    const html = renderFacts();

    expect(html).toContain('13.06.2026');
    expect(html).toContain('27.06.2026');
    expect(html).toContain('9,50 %');
    expect(html).toContain('202600017');
    expect(html).toContain('ORDER-1');
    expect(html).toContain('Worksite Street 4');
    expect(html).toContain('Approved invoice');
    expect(html).toContain('Invoice note');
  });

  it('hides empty optional invoice fields', () => {
    const html = renderFacts({
      deliveryAddressText: '',
      note: '',
      orderNumber: '',
      subject: '',
    });

    expect(html).not.toContain(`${uiText.invoicing.deliveryAddressText}:`);
    expect(html).not.toContain(`${uiText.invoicing.note}:`);
    expect(html).not.toContain(`${uiText.invoicing.orderNumber}:`);
    expect(html).not.toContain(`${uiText.invoicing.subject}:`);
  });

  it('shows a refund account only on a credit invoice', () => {
    const creditHtml = renderFacts({
      invoiceKind: 'credit',
      refundIbanSnapshot: 'FI2112345600000785',
    });
    const standardHtml = renderFacts({
      invoiceKind: 'standard',
      refundIbanSnapshot: 'FI2112345600000785',
    });

    expect(creditHtml).toContain(uiText.invoicing.creditDraftRefundIban);
    expect(creditHtml).toContain('FI21 1234 5600 0007 85');
    expect(standardHtml).not.toContain(
      uiText.invoicing.creditDraftRefundIban,
    );
  });

  it('shows a normal invoice single performance date once', () => {
    const html = renderFacts({
      performancePeriod: {
        type: 'singleDate',
        date: '2026-06-18',
      },
    });

    expect(html).toContain(uiText.invoicing.performanceDate);
    expect(html.match(/18\.06\.2026/g)).toHaveLength(1);
  });

  it('shows a normal invoice performance range once', () => {
    const html = renderFacts({
      performancePeriod: {
        type: 'dateRange',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      },
    });

    expect(html).toContain(uiText.invoicing.performancePeriodDateRange);
    expect(html.match(/01\.06\.2026–15\.06\.2026/g)).toHaveLength(1);
  });

  it('keeps an inherited performance date visible on a credit invoice', () => {
    const html = renderFacts({
      invoiceKind: 'credit',
      performancePeriod: {
        type: 'singleDate',
        date: '2026-06-18',
      },
    });

    expect(html).toContain(uiText.invoicing.performanceDate);
    expect(html).toContain('18.06.2026');
  });

  it('does not add a separate row when performance follows invoice date', () => {
    const html = renderFacts({
      performancePeriod: { type: 'invoiceDate' },
    });

    expect(html).not.toContain(`${uiText.invoicing.performanceDate}:`);
    expect(html).not.toContain(
      `${uiText.invoicing.performancePeriodDateRange}:`,
    );
  });
});

type ApprovedInvoiceFactsProps = React.ComponentProps<
  typeof ApprovedInvoiceFacts
>;

function renderFacts(
  overrides: Partial<ApprovedInvoiceFactsProps> = {},
): string {
  return renderToStaticMarkup(
    <ApprovedInvoiceFacts
      approvedAt="2026-06-13T10:00:00.000Z"
      creditedInvoiceDate={null}
      creditedInvoiceNumber={null}
      deliveryAddressText="Worksite Street 4"
      dueDate="2026-06-27"
      invoiceDate="2026-06-13"
      invoiceKind="standard"
      latePaymentInterestBasisPoints={950}
      note="Invoice note"
      orderNumber="ORDER-1"
      paymentTermDays={14}
      referenceNumber="202600017"
      refundIbanSnapshot=""
      reminderPeriodDays={8}
      subject="Approved invoice"
      taxLegalBasisSnapshot=""
      taxTreatment="normalVat"
      taxTreatmentLabelSnapshot=""
      performancePeriod={{ type: 'invoiceDate' }}
      {...overrides}
    />,
  );
}
