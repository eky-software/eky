import type { Customer, InvoiceDraftSummary } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoicingPageView } from './InvoicingPage.js';
import { uiText } from '../../i18n/fi.js';

describe('InvoicingPageView', () => {
  it('renders invoice draft summaries and the new invoice placeholder', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [createInvoiceDraftSummary()],
      errorMessage: null,
      isLoading: false,
      onBackToDrafts: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain('Testilasku');
    expect(html).toContain('1001 – Esimerkki Asiakas Oy');
    expect(html).not.toContain('customer-1');
    expect(html).not.toContain('draft-1');
    expect(html).toContain('13.06.2026');
    expect(html).toContain('27.06.2026');
    expect(html).toContain('178,84');
    expect(html).toContain(uiText.invoicing.statusDraft);
    expect(html).toContain(uiText.invoicing.newInvoice);
    expect(html).not.toContain(uiText.invoicing.saveDraft);
  });

  it('renders the empty state', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      onBackToDrafts: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.empty);
  });

  it('renders a safe error state without technical response data', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: uiText.invoicing.loadError,
      isLoading: false,
      onBackToDrafts: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.loadError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the loading state', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: true,
      onBackToDrafts: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.loading);
  });

  it('renders the new invoice Classic form shell', () => {
    const html = renderPage({
      activeView: 'newInvoice',
      customerListState: {
        customers: [],
        errorMessage: null,
        isLoading: true,
      },
      drafts: [],
      errorMessage: null,
      isLoading: false,
      onBackToDrafts: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.backToDrafts);
    expect(html).toContain(uiText.invoicing.customerLoading);
    expect(html).toContain(uiText.invoicing.invoiceDate);
    expect(html).toContain(uiText.invoicing.paymentTermDays);
    expect(html).toContain(uiText.invoicing.dueDate);
    expect(html).toContain(uiText.invoicing.subject);
    expect(html).toContain(uiText.invoicing.orderNumber);
    expect(html).toContain(uiText.invoicing.note);
    expect(html).toContain(uiText.invoicing.priceInputNet);
    expect(html).toContain(uiText.invoicing.priceInputGross);
    expect(html).toContain(uiText.invoicing.invoiceRowsHelp);
    expect(html).toContain(uiText.invoicing.addRow);
    expect(html).toContain(uiText.invoicing.rowDescriptionPlaceholder);
    expect(html).toContain(uiText.invoicing.invoiceTotalsPreviewHelp);
    expect(html).toContain(uiText.invoicing.invoiceTotalsUnavailable);
    expect(html).toContain(uiText.invoicing.validateForm);
    expect(html).toContain(uiText.invoicing.saveDraft);
    expect(html).not.toContain(uiText.invoicing.saveDraftLater);
  });
});

function renderPage(props: React.ComponentProps<typeof InvoicingPageView>): string {
  return renderToStaticMarkup(<InvoicingPageView {...props} />);
}

function createCustomerListState() {
  return {
    customers: [createCustomer()],
    errorMessage: null,
    isLoading: false,
  };
}

function createCustomer(): Customer {
  return {
    businessId: '1234567-8',
    city: 'Helsinki',
    comment: '',
    companyId: 'dev-company',
    createdAt: '2026-06-13T18:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'testi@example.fi',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Asiakas Oy',
    phone: '040 123 4567',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Testikatu 1',
    updatedAt: '2026-06-13T18:00:00.000Z',
  };
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
