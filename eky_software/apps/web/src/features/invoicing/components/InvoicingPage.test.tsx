import type { Customer, InvoiceDraftSummary } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoicingPageView } from './InvoicingPage.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoicingPageView', () => {
  it('renders invoice draft summaries and the new invoice placeholder', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [createInvoiceDraftSummary()],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
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
    expect(html).toContain('<button');
    expect(html).not.toContain(uiText.invoicing.saveDraft);
  });

  it('renders the empty state', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
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
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
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
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
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
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
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

  it('renders the edit loading state while an invoice draft is opening', () => {
    const html = renderPage({
      activeView: 'editInvoice',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState({
        isLoading: true,
      }),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.openingDraft);
  });

  it('renders a safe edit open error without technical response data', () => {
    const html = renderPage({
      activeView: 'editInvoice',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState({
        errorMessage: uiText.invoicing.openDraftError,
      }),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.openDraftError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('hydrates an opened invoice draft into the edit form', () => {
    const html = renderPage({
      activeView: 'editInvoice',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState({
        draft: createInvoiceDraft(),
      }),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.editInvoice);
    expect(html).toContain('Työlasku');
    expect(html).toContain('Saate');
    expect(html).toContain('ORDER-1');
    expect(html).toContain('Työtunti');
    expect(html).toContain('65,50');
    expect(html).toContain(uiText.invoicing.saveDraftChanges);
  });
});

type InvoicingPageViewProps = React.ComponentProps<typeof InvoicingPageView>;

function renderPage(
  props: Omit<InvoicingPageViewProps, 'onDraftSaved' | 'refreshDrafts'> &
    Partial<Pick<InvoicingPageViewProps, 'onDraftSaved' | 'refreshDrafts'>>,
): string {
  return renderToStaticMarkup(
    <InvoicingPageView
      onDraftSaved={vi.fn()}
      refreshDrafts={vi.fn()}
      {...props}
    />,
  );
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

function createDraftEditorState(
  overrides: Partial<React.ComponentProps<typeof InvoicingPageView>['draftEditorState']> = {},
) {
  return {
    clearDraft: vi.fn(),
    draft: null,
    errorMessage: null,
    isLoading: false,
    openDraft: vi.fn(),
    replaceDraft: vi.fn(),
    ...overrides,
  };
}

function createInvoiceDraft() {
  return {
    companyId: 'dev-company',
    createdAt: '2026-06-16T12:00:00.000Z',
    customerId: 'customer-1',
    dueDate: '2026-06-30',
    id: 'draft-1',
    invoiceDate: '2026-06-16',
    lines: [
      {
        baseCents: 9825,
        code: '',
        description: 'Työtunti',
        discount: {
          type: 'none' as const,
        },
        discountCents: 0,
        grossCents: 12_331,
        id: 'line-1',
        netCents: 9825,
        position: 1,
        priceInputMode: 'net' as const,
        quantityHundredths: 150,
        unit: 'h' as const,
        unitPriceCents: 6550,
        vatCents: 2506,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Saate',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    priceInputMode: 'net' as const,
    status: 'draft' as const,
    subject: 'Työlasku',
    totals: {
      grossTotalCents: 12_331,
      netTotalCents: 9825,
      vatBreakdown: [
        {
          grossCents: 12_331,
          netCents: 9825,
          vatCents: 2506,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2506,
    },
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}
