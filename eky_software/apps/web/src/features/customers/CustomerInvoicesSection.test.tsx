import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ApprovedInvoiceSummary,
  SentInvoiceGroup,
} from '@eky/api-client';

import { CustomerInvoicesSection } from './CustomerInvoicesSection.js';
import type { CustomerInvoiceOverviewState } from './hooks/useCustomerInvoices.js';

describe('CustomerInvoicesSection', () => {
  it('renders customer-filtered invoice states and typed open actions', () => {
    const invoiceState = createInvoiceState();
    invoiceState.drafts = {
      items: [
        {
          creditedInvoiceId: null,
          customerId: 'customer-1',
          dueDate: '2026-08-15',
          grossTotalCents: 12_400,
          id: 'draft-1',
          invoiceDate: '2026-08-01',
          invoiceKind: 'standard',
          latePaymentInterestBasisPoints: 950,
          netTotalCents: 10_000,
          paymentTermDays: 14,
          priceInputMode: 'net',
          status: 'draft',
          subject: 'Ikkunatyö',
          updatedAt: '2026-08-02T10:00:00.000Z',
          vatTotalCents: 2_400,
        },
      ],
      page: 1,
      totalCount: 1,
      totalPages: 1,
    };

    const html = renderToStaticMarkup(
      <CustomerInvoicesSection
        invoiceState={invoiceState}
        onOpenInvoice={() => undefined}
      />,
    );

    expect(html).toContain('Asiakkaan laskut');
    expect(html).toContain('Luonnokset');
    expect(html).toContain('124,00');
    expect(html).toContain('Avaa laskutuksessa');
    expect(html).toContain('Rivejä osiossa');
    expect(html).toContain('Uusimmat ensin');
    expect(html).toContain('<option value="5" selected="">5</option>');
    expect(html).not.toContain('Asiakas A–Ö');
  });

  it('keeps an invoice read error inside the invoice section', () => {
    const invoiceState = createInvoiceState();
    invoiceState.paid = {
      items: [createPaidInvoiceGroup()],
      page: 1,
      totalCount: 1,
      totalPages: 1,
    };
    invoiceState.errorMessage =
      'Asiakkaan laskuja ei voitu ladata turvallisesti.';

    const html = renderToStaticMarkup(
      <CustomerInvoicesSection
        invoiceState={invoiceState}
        onOpenInvoice={() => undefined}
      />,
    );

    expect(html).toContain(
      'Asiakkaan laskuja ei voitu ladata turvallisesti.',
    );
    expect(html).toContain('Maksetut');
    expect(html).toContain('20260010');
    expect(html).toContain('Maksupäivä');
    expect(html).toContain('12.08.2026');
    expect(html).not.toContain('responseBody');
  });
});

function createInvoiceState(): CustomerInvoiceOverviewState {
  return {
    approved: createEmptyPage(),
    cancelled: createEmptyPage(),
    credited: createEmptyPage(),
    drafts: createEmptyPage(),
    errorMessage: null,
    goToPage: () => undefined,
    isLoading: false,
    pageSize: 5,
    paid: createEmptyPage(),
    sent: createEmptyPage(),
    setPageSize: () => undefined,
    setSort: () => undefined,
    sort: 'invoiceDateDesc',
  };
}

function createEmptyPage() {
  return {
    items: [],
    page: 1,
    totalCount: 0,
    totalPages: 0,
  };
}

function createPaidInvoiceGroup(): SentInvoiceGroup {
  return {
    creditInvoices: [],
    creditStatus: 'none',
    remainingCreditableGrossCents: 12_400,
    rootInvoice: createPaidInvoiceSummary(),
  };
}

function createPaidInvoiceSummary(): ApprovedInvoiceSummary {
  return {
    approvedAt: '2026-08-01T10:00:00.000Z',
    billingRecipientNameSnapshot: 'Esimerkki Oy',
    cancelledAt: null,
    creditedInvoiceId: null,
    customerId: 'customer-1',
    customerNameSnapshot: 'Esimerkki Oy',
    customerNumberSnapshot: '1001',
    dueDate: '2026-08-15',
    grossTotalCents: 12_400,
    id: 'invoice-paid',
    invoiceDate: '2026-08-01',
    invoiceKind: 'standard',
    invoiceNumber: '20260010',
    paidAmountCents: 12_400,
    paidOn: '2026-08-12',
    paymentSource: 'manual',
    paymentState: 'paid',
    referenceNumber: '202600106',
    status: 'sent',
    updatedAt: '2026-08-12T10:00:00.000Z',
  };
}
