import type {
  ApprovedInvoiceSummary,
  Customer,
  InvoiceDraftSummary,
} from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceWorkspaceListView } from './InvoiceWorkspaceListView.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceWorkspaceListView', () => {
  it('renders invoice draft summaries and list workspace actions', () => {
    const html = renderView({
      approvedInvoicePageState: createApprovedInvoicePageState({
        invoices: [createApprovedInvoiceSummary()],
        totalCount: 1,
        totalPages: 1,
      }),
      drafts: [createInvoiceDraftSummary()],
    });

    expect(html).toContain('Testilasku');
    expect(html).toContain('1001 – Esimerkki Asiakas Oy');
    expect(html).not.toContain('customer-1');
    expect(html).not.toContain('draft-1');
    expect(html).toContain('13.06.2026');
    expect(html).toContain('27.06.2026');
    expect(html).toContain('178,84');
    expect(html).toContain(uiText.invoicing.statusDraft);
    expect(html).toContain(`aria-label="${uiText.invoicing.deleteDraft}"`);
    expect(html).toContain(uiText.invoicing.newInvoice);
    expect(html).toContain(uiText.invoicing.approvedInvoiceList);
    expect(html).toContain('Laskunumero 20260001');
    expect(html).toContain('<button');
    expect(html).not.toContain(uiText.invoicing.saveDraft);
  });

  it('renders an inline confirmation before deleting a draft', () => {
    const html = renderView({
      drafts: [createInvoiceDraftSummary()],
      pendingDeleteDraftId: 'draft-1',
    });

    expect(html).toContain(uiText.invoicing.deleteDraftConfirm);
    expect(html).toContain(uiText.invoicing.deleteDraftConfirmAction);
    expect(html).toContain(uiText.invoicing.deleteDraftCancel);
  });

  it('renders a safe draft deletion error without technical response data', () => {
    const html = renderView({
      deleteErrorMessage: uiText.invoicing.deleteDraftError,
      drafts: [createInvoiceDraftSummary()],
    });

    expect(html).toContain(uiText.invoicing.deleteDraftError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the empty state', () => {
    const html = renderView();

    expect(html).toContain(uiText.invoicing.empty);
  });

  it('splits approved and sent invoices into separate lists', () => {
    const html = renderView({
      approvedInvoicePageState: createApprovedInvoicePageState({
        invoices: [createApprovedInvoiceSummary()],
        totalCount: 1,
        totalPages: 1,
      }),
      sentInvoicePageState: createApprovedInvoicePageState({
        invoices: [
          createApprovedInvoiceSummary({
            id: 'invoice-2',
            invoiceNumber: '20260002',
            status: 'sent',
          }),
        ],
        totalCount: 1,
        totalPages: 1,
      }),
    });
    const approvedListStart = html.indexOf(
      `aria-label="${uiText.invoicing.approvedInvoiceList}"`,
    );
    const approvedInvoice = html.indexOf('Laskunumero 20260001');
    const sentListStart = html.indexOf(
      `aria-label="${uiText.invoicing.sentInvoiceList}"`,
    );
    const sentInvoice = html.indexOf('Laskunumero 20260002');

    expect(approvedListStart).toBeGreaterThan(-1);
    expect(approvedInvoice).toBeGreaterThan(approvedListStart);
    expect(sentListStart).toBeGreaterThan(approvedInvoice);
    expect(sentInvoice).toBeGreaterThan(sentListStart);
    expect(html).not.toContain(uiText.invoicing.copyApprovedInvoice);
  });

  it('renders cancelled invoices in their own read-only list', () => {
    const html = renderView({
      cancelledInvoicePageState: createApprovedInvoicePageState({
        invoices: [
          createApprovedInvoiceSummary({
            cancelledAt: '2026-07-23T12:00:00.000Z',
            id: 'invoice-cancelled',
            invoiceNumber: '20260009',
            status: 'cancelled',
          }),
        ],
        totalCount: 1,
        totalPages: 1,
      }),
    });

    expect(html).toContain(uiText.invoicing.cancelledInvoiceList);
    expect(html).toContain('Laskunumero 20260009');
    expect(html).toContain(uiText.invoicing.statusCancelled);
  });

  it('renders a safe loading error without technical response data', () => {
    const html = renderView({
      draftErrorMessage: uiText.invoicing.loadError,
    });

    expect(html).toContain(uiText.invoicing.loadError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the loading state', () => {
    const html = renderView({
      isDraftListLoading: true,
    });

    expect(html).toContain(uiText.invoicing.loading);
  });
});

type InvoiceWorkspaceListViewProps = React.ComponentProps<
  typeof InvoiceWorkspaceListView
>;

function renderView(
  overrides: Partial<InvoiceWorkspaceListViewProps> = {},
): string {
  return renderToStaticMarkup(
    <InvoiceWorkspaceListView
      approvedInvoicePageState={createApprovedInvoicePageState()}
      cancelledInvoicePageState={createApprovedInvoicePageState()}
      customers={[createCustomer()]}
      customerErrorMessage={null}
      deleteErrorMessage={null}
      deletingDraftId={null}
      drafts={[]}
      draftErrorMessage={null}
      isCustomerListLoading={false}
      isDraftListLoading={false}
      pendingDeleteDraftId={null}
      sentInvoicePageState={createApprovedInvoicePageState()}
      onCancelDeleteDraft={vi.fn()}
      onConfirmDeleteDraft={vi.fn()}
      onNewInvoice={vi.fn()}
      onOpenApprovedInvoice={vi.fn()}
      onOpenDraft={vi.fn()}
      onRequestDeleteDraft={vi.fn()}
      {...overrides}
    />,
  );
}

function createApprovedInvoicePageState(
  overrides: Partial<
    InvoiceWorkspaceListViewProps['approvedInvoicePageState']
  > = {},
): InvoiceWorkspaceListViewProps['approvedInvoicePageState'] {
  return {
    controls: {
      fiscalYearStartYear: 2026,
      month: '2026-07',
      page: 1,
      pageSize: 20,
      periodMode: 'all',
      sort: 'invoiceDateDesc',
    },
    errorMessage: null,
    goToPage: vi.fn(),
    invoiceGroups: [],
    invoices: [],
    isFiscalYearFilterAvailable: true,
    isLoading: false,
    refresh: vi.fn(async () => undefined),
    setFiscalYearStartYear: vi.fn(),
    setMonth: vi.fn(),
    setPageSize: vi.fn(),
    setPeriodMode: vi.fn(),
    setSort: vi.fn(),
    totalCount: 0,
    totalPages: 0,
    ...overrides,
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
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    subject: 'Testilasku',
    netTotalCents: 14_250,
    vatTotalCents: 3634,
    grossTotalCents: 17_884,
    updatedAt: '2026-06-13T18:00:00.000Z',
  };
}

function createApprovedInvoiceSummary(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
  return {
    id: 'invoice-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Esimerkki Asiakas Oy',
    billingRecipientNameSnapshot: 'Esimerkki Asiakas Oy',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    grossTotalCents: 17_884,
    approvedAt: '2026-06-13T18:00:00.000Z',
    cancelledAt: null,
    updatedAt: '2026-06-13T18:00:00.000Z',
    ...overrides,
  };
}
