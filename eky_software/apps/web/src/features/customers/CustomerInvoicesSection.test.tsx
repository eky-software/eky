import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

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
  });

  it('keeps an invoice read error inside the invoice section', () => {
    const invoiceState = createInvoiceState();
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
    sent: createEmptyPage(),
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
