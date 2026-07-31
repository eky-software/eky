import type { InvoiceDraftSummary } from '@eky/api-client';

import type {
  CustomerInvoiceListPageSize,
  CustomerInvoiceListSort,
} from './customerInvoiceListState.js';

interface CustomerInvoiceDraftPage {
  items: InvoiceDraftSummary[];
  page: number;
  totalCount: number;
  totalPages: number;
}

export function createCustomerInvoiceDraftPage(
  drafts: readonly InvoiceDraftSummary[],
  page: number,
  pageSize: CustomerInvoiceListPageSize,
  sort: CustomerInvoiceListSort,
): CustomerInvoiceDraftPage {
  const sortedDrafts = [...drafts].sort((first, second) =>
    compareInvoiceDrafts(first, second, sort),
  );
  const firstDraftIndex = (page - 1) * pageSize;

  return {
    items: sortedDrafts.slice(firstDraftIndex, firstDraftIndex + pageSize),
    page,
    totalCount: sortedDrafts.length,
    totalPages: Math.ceil(sortedDrafts.length / pageSize),
  };
}

function compareInvoiceDrafts(
  first: InvoiceDraftSummary,
  second: InvoiceDraftSummary,
  sort: CustomerInvoiceListSort,
): number {
  switch (sort) {
    case 'invoiceDateAsc':
      return (
        first.invoiceDate.localeCompare(second.invoiceDate) ||
        first.id.localeCompare(second.id)
      );
    case 'dueDateAsc':
      return (
        first.dueDate.localeCompare(second.dueDate) ||
        first.id.localeCompare(second.id)
      );
    case 'invoiceDateDesc':
      return (
        second.invoiceDate.localeCompare(first.invoiceDate) ||
        second.id.localeCompare(first.id)
      );
  }
}
