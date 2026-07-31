import type { ApprovedInvoiceSummary } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BillingRecipientInvoicesSection } from './BillingRecipientInvoicesSection.js';
import type { BillingRecipientInvoiceOverviewState } from './hooks/useBillingRecipientInvoices.js';

describe('BillingRecipientInvoicesSection', () => {
  it('shows housing company snapshot data without draft categories', () => {
    const invoiceState = createInvoiceState();
    invoiceState.approved = {
      items: [createApprovedInvoice()],
      page: 1,
      totalCount: 1,
      totalPages: 1,
    };

    const html = renderToStaticMarkup(
      <BillingRecipientInvoicesSection
        invoiceState={invoiceState}
        onOpenInvoice={() => undefined}
      />,
    );

    expect(html).toContain('Taloyhtiöiden laskut vastaanottajana');
    expect(html).toContain('2002 – Asunto Oy Esimerkkipiha');
    expect(html).toContain('Hyväksytyt ja toimitusta odottavat');
    expect(html).toContain('>Avaa lasku</button>');
    expect(html).toContain('<option value="5" selected="">5</option>');
    expect(html).not.toContain('>Luonnokset<');
  });

  it('contains a safe load failure inside the recipient invoice panel', () => {
    const invoiceState = createInvoiceState();
    invoiceState.errorMessage =
      'Vastaanottajana saatuja taloyhtiölaskuja ei voitu ladata turvallisesti.';

    const html = renderToStaticMarkup(
      <BillingRecipientInvoicesSection
        invoiceState={invoiceState}
        onOpenInvoice={() => undefined}
      />,
    );

    expect(html).toContain(
      'Vastaanottajana saatuja taloyhtiölaskuja ei voitu ladata turvallisesti.',
    );
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });
});

function createInvoiceState(): BillingRecipientInvoiceOverviewState {
  return {
    approved: createEmptyPage(),
    cancelled: createEmptyPage(),
    credited: createEmptyPage(),
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

function createApprovedInvoice(): ApprovedInvoiceSummary {
  return {
    approvedAt: '2026-08-01T10:00:00.000Z',
    billingRecipientNameSnapshot: 'Selkeä Isännöinti Oy',
    cancelledAt: null,
    creditedInvoiceId: null,
    customerId: 'housing-company-1',
    customerNameSnapshot: 'Asunto Oy Esimerkkipiha',
    customerNumberSnapshot: '2002',
    dueDate: '2026-08-15',
    grossTotalCents: 12_400,
    id: 'invoice-1',
    invoiceDate: '2026-08-01',
    invoiceKind: 'standard',
    invoiceNumber: '2026001',
    paidAmountCents: null,
    paidOn: null,
    paymentSource: null,
    paymentState: 'unpaid',
    referenceNumber: '20260013',
    status: 'approved',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}
