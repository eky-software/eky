import type {
  ApprovedInvoiceSummary,
  SentInvoiceGroup,
} from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SentInvoiceGroupList } from './SentInvoiceGroupList.js';
import { uiText } from '../../../i18n/fi.js';

describe('SentInvoiceGroupList', () => {
  it('renders sent credits under their root with signed amounts', () => {
    const html = renderToStaticMarkup(
      <SentInvoiceGroupList
        groups={[createGroup()]}
        listLabel={uiText.invoicing.sentInvoiceList}
        onOpenApprovedInvoice={vi.fn()}
      />,
    );

    expect(html).toContain('Laskunumero 20260001');
    expect(html).toContain('Hyvityslasku 20260002');
    expect(html).toContain('−25,50');
    expect(html).toContain(uiText.invoicing.status);
    expect(html).toContain(uiText.invoicing.creditStatusPartial);
    expect(html).not.toContain(uiText.invoicing.statusCredited);
    expect(html).toContain('Hyvitettävissä 100,00');
  });

  it('shows the full-credit state when nothing remains creditable', () => {
    const html = renderToStaticMarkup(
      <SentInvoiceGroupList
        groups={[
          createGroup({
            creditStatus: 'full',
            remainingCreditableGrossCents: 0,
          }),
        ]}
        listLabel={uiText.invoicing.sentInvoiceList}
        onOpenApprovedInvoice={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.statusCredited);
  });

  it('shows paid only for an uncredited paid root invoice', () => {
    const html = renderToStaticMarkup(
      <SentInvoiceGroupList
        groups={[
          createGroup({
            creditInvoices: [],
            creditStatus: 'none',
            rootInvoice: createSummary({
              paidAmountCents: 12_550,
              paidOn: '2026-07-31',
              paymentSource: 'manual',
              paymentState: 'paid',
            }),
          }),
        ]}
        listLabel={uiText.invoicing.paidInvoiceList}
        onOpenApprovedInvoice={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.statusPaid);
    expect(html).not.toContain(uiText.invoicing.statusCredited);
  });
});

function createGroup(
  overrides: Partial<SentInvoiceGroup> = {},
): SentInvoiceGroup {
  const rootInvoice = createSummary();

  return {
    rootInvoice,
    creditInvoices: [
      createSummary({
        id: 'credit-invoice-1',
        invoiceKind: 'credit',
        creditedInvoiceId: rootInvoice.id,
        invoiceNumber: '20260002',
        referenceNumber: '',
        grossTotalCents: 2_550,
      }),
    ],
    creditStatus: 'partial',
    remainingCreditableGrossCents: 10_000,
    ...overrides,
  };
}

function createSummary(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
  return {
    approvedAt: '2026-07-01T10:00:00.000Z',
    billingRecipientNameSnapshot: 'Esimerkki Oy',
    cancelledAt: null,
    creditedInvoiceId: null,
    customerId: 'customer-1',
    customerNameSnapshot: 'Esimerkki Oy',
    customerNumberSnapshot: '1001',
    dueDate: '2026-07-15',
    grossTotalCents: 12_550,
    id: 'invoice-1',
    invoiceDate: '2026-07-01',
    invoiceKind: 'standard',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'sent',
    updatedAt: '2026-07-01T10:00:00.000Z',
    paymentState:
      overrides.invoiceKind === 'credit' ? 'notApplicable' : 'unpaid',
    paidOn: null,
    paidAmountCents: null,
    paymentSource: null,
    ...overrides,
  };
}
