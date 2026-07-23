import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceListSection } from './ApprovedInvoiceListSection.js';
import type { ApprovedInvoicePageState } from '../hooks/useApprovedInvoicePage.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoiceListSection', () => {
  it('renders compact period, sort, page size and pagination controls', () => {
    const html = renderToStaticMarkup(
      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.approvedInvoiceCount}
        emptyMessage={uiText.invoicing.approvedInvoicesEmpty}
        kicker={uiText.invoicing.approvedInvoices}
        listLabel={uiText.invoicing.approvedInvoiceList}
        loadingMessage={uiText.invoicing.approvedInvoicesLoading}
        pageState={createPageState()}
        title={uiText.invoicing.approvedInvoiceList}
        onOpenApprovedInvoice={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.listPeriod);
    expect(html).toContain(uiText.invoicing.listPeriodMonth);
    expect(html).toContain(uiText.invoicing.listPeriodFiscalYear);
    expect(html).toContain(uiText.invoicing.listSortNewest);
    expect(html).toContain(uiText.invoicing.listSortCustomer);
    expect(html).toContain('value="20"');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="100"');
    expect(html).toContain('Sivu 2 / 4');
    expect(html).toContain('>37</span>');
  });

  it('renders the selected month control without exposing companyId', () => {
    const pageState = createPageState({
      controls: {
        ...createPageState().controls,
        month: '2026-07',
        periodMode: 'month',
      },
    });
    const html = renderToStaticMarkup(
      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.sentInvoiceCount}
        emptyMessage={uiText.invoicing.sentInvoicesEmpty}
        kicker={uiText.invoicing.sentInvoices}
        listLabel={uiText.invoicing.sentInvoiceList}
        loadingMessage={uiText.invoicing.sentInvoicesLoading}
        pageState={pageState}
        title={uiText.invoicing.sentInvoiceList}
        onOpenApprovedInvoice={vi.fn()}
      />,
    );

    expect(html).toContain('type="month"');
    expect(html).toContain('value="2026-07"');
    expect(html).not.toContain('companyId');
  });

  it('hides pagination controls when the filtered list is empty', () => {
    const html = renderToStaticMarkup(
      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.approvedInvoiceCount}
        emptyMessage={uiText.invoicing.approvedInvoicesEmpty}
        kicker={uiText.invoicing.approvedInvoices}
        listLabel={uiText.invoicing.approvedInvoiceList}
        loadingMessage={uiText.invoicing.approvedInvoicesLoading}
        pageState={createPageState({ totalCount: 0, totalPages: 0 })}
        title={uiText.invoicing.approvedInvoiceList}
        onOpenApprovedInvoice={vi.fn()}
      />,
    );

    expect(html).not.toContain(uiText.invoicing.listPreviousPage);
    expect(html).not.toContain(uiText.invoicing.listNextPage);
  });
});

function createPageState(
  overrides: Partial<ApprovedInvoicePageState> = {},
): ApprovedInvoicePageState {
  return {
    controls: {
      fiscalYearStartYear: 2026,
      month: '2026-07',
      page: 2,
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
    totalCount: 37,
    totalPages: 4,
    ...overrides,
  };
}
