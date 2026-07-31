import type {
  ApprovedInvoiceListQuery,
  SentInvoiceGroupListQuery,
} from './approvedInvoicesTypes.js';

export function serializeApprovedInvoiceListQuery(
  query: ApprovedInvoiceListQuery,
): string {
  const searchParameters = new URLSearchParams({
    status: query.status,
  });
  appendInvoiceListSearchParameters(searchParameters, query);

  return searchParameters.toString();
}

export function serializeSentInvoiceGroupListQuery(
  query: SentInvoiceGroupListQuery,
): string {
  const searchParameters = new URLSearchParams();
  appendInvoiceListSearchParameters(searchParameters, query);

  if (query.creditState !== undefined) {
    searchParameters.set('creditState', query.creditState);
  }

  if (query.paymentState !== undefined) {
    searchParameters.set('paymentState', query.paymentState);
  }

  return searchParameters.toString();
}

function appendInvoiceListSearchParameters(
  searchParameters: URLSearchParams,
  query: SentInvoiceGroupListQuery,
): void {
  searchParameters.set('page', String(query.page));
  searchParameters.set('pageSize', String(query.pageSize));
  searchParameters.set('sort', query.sort);

  if (query.dateFrom !== undefined) {
    searchParameters.set('dateFrom', query.dateFrom);
  }

  if (query.dateTo !== undefined) {
    searchParameters.set('dateTo', query.dateTo);
  }

  if (query.customerId !== undefined) {
    searchParameters.set('customerId', query.customerId);
  }
}
