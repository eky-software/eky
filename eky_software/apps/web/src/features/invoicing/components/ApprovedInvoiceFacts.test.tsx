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
      {...overrides}
    />,
  );
}
