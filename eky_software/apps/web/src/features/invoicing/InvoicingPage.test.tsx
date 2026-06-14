import type { InvoiceDraftSummary } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvoicingPageView } from './InvoicingPage.js';
import { uiText } from '../../i18n/fi.js';

describe('InvoicingPageView', () => {
  it('renders invoice draft summaries and the new invoice placeholder', () => {
    const html = renderPage({
      drafts: [createInvoiceDraftSummary()],
      errorMessage: null,
      isLoading: false,
    });

    expect(html).toContain('Testilasku');
    expect(html).toContain('customer-1');
    expect(html).toContain('13.06.2026');
    expect(html).toContain('27.06.2026');
    expect(html).toContain('178,84');
    expect(html).toContain(uiText.invoicing.statusDraft);
    expect(html).toContain(uiText.invoicing.newInvoice);
    expect(html).toContain('disabled=""');
  });

  it('renders the empty state', () => {
    const html = renderPage({
      drafts: [],
      errorMessage: null,
      isLoading: false,
    });

    expect(html).toContain(uiText.invoicing.empty);
  });

  it('renders a safe error state without technical response data', () => {
    const html = renderPage({
      drafts: [],
      errorMessage: uiText.invoicing.loadError,
      isLoading: false,
    });

    expect(html).toContain(uiText.invoicing.loadError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the loading state', () => {
    const html = renderPage({
      drafts: [],
      errorMessage: null,
      isLoading: true,
    });

    expect(html).toContain(uiText.invoicing.loading);
  });
});

function renderPage(props: React.ComponentProps<typeof InvoicingPageView>): string {
  return renderToStaticMarkup(<InvoicingPageView {...props} />);
}

function createInvoiceDraftSummary(): InvoiceDraftSummary {
  return {
    id: 'draft-1',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    priceInputMode: 'net',
    subject: 'Testilasku',
    netTotalCents: 14_250,
    vatTotalCents: 3634,
    grossTotalCents: 17_884,
    updatedAt: '2026-06-13T18:00:00.000Z',
  };
}
