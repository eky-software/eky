import type { ApprovedInvoiceListQuery } from './approvedInvoicesTypes.js';

export function serializeApprovedInvoiceListQuery(
  query: ApprovedInvoiceListQuery,
): string {
  const searchParameters = new URLSearchParams({
    status: query.status,
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
  });

  if (query.dateFrom !== undefined) {
    searchParameters.set('dateFrom', query.dateFrom);
  }

  if (query.dateTo !== undefined) {
    searchParameters.set('dateTo', query.dateTo);
  }

  return searchParameters.toString();
}
