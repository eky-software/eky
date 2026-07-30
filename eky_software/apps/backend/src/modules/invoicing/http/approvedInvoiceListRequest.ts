import type { ListApprovedInvoicesInput } from '../application/listApprovedInvoices.js';
import type { ListSentInvoiceGroupsInput } from '../application/listSentInvoiceGroups.js';
import { normalizeOptionalInvoiceListCustomerId } from '../application/invoiceListCustomerFilter.js';
import type { ApprovedInvoiceListSort } from '../domain/approvedInvoiceSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

const allowedFields = new Set([
  'status',
  'customerId',
  'dateFrom',
  'dateTo',
  'page',
  'pageSize',
  'sort',
]);
const sentGroupAllowedFields = new Set([...allowedFields, 'creditState']);

export function parseApprovedInvoiceListRequest(
  companyId: string,
  query: Record<string, string>,
): ListApprovedInvoicesInput {
  for (const field of Object.keys(query)) {
    if (!allowedFields.has(field)) {
      throw new InvoiceDraftValidationError(
        'Invoice list query contains an unsupported field.',
      );
    }
  }

  const dateFrom = parseOptionalValue(query.dateFrom);
  const dateTo = parseOptionalValue(query.dateTo);
  const customerId = normalizeOptionalInvoiceListCustomerId(query.customerId);

  return {
    companyId,
    status: parseStatus(query.status),
    page: parseInteger(query.page, 1),
    pageSize: parseInteger(query.pageSize, 20),
    sort: parseSort(query.sort),
    ...(customerId === null ? {} : { customerId }),
    ...(dateFrom === undefined ? {} : { dateFrom }),
    ...(dateTo === undefined ? {} : { dateTo }),
  };
}

export function parseSentInvoiceGroupListRequest(
  companyId: string,
  query: Record<string, string>,
): ListSentInvoiceGroupsInput {
  for (const field of Object.keys(query)) {
    if (!sentGroupAllowedFields.has(field) || field === 'status') {
      throw new InvoiceDraftValidationError(
        'Sent invoice group query contains an unsupported field.',
      );
    }
  }

  const { creditState, ...listQuery } = query;
  const { status: _status, ...input } = parseApprovedInvoiceListRequest(
    companyId,
    { ...listQuery, status: 'sent' },
  );

  return {
    ...input,
    creditState: parseSentInvoiceCreditState(creditState),
  };
}

function parseSentInvoiceCreditState(
  value: string | undefined,
): 'all' | 'uncredited' | 'credited' {
  if (value === undefined || value === 'all') {
    return 'all';
  }

  if (value === 'uncredited' || value === 'credited') {
    return value;
  }

  throw new InvoiceDraftValidationError(
    'Sent invoice group credit state is invalid.',
  );
}

function parseStatus(
  value: string | undefined,
): 'approved' | 'sent' | 'cancelled' {
  if (value === undefined || value === 'approved') {
    return 'approved';
  }

  if (value === 'sent') {
    return 'sent';
  }

  if (value === 'cancelled') {
    return 'cancelled';
  }

  throw new InvoiceDraftValidationError('Invoice list status is invalid.');
}

function parseSort(value: string | undefined): ApprovedInvoiceListSort {
  if (value === undefined || value === 'invoiceDateDesc') {
    return 'invoiceDateDesc';
  }

  if (
    value === 'invoiceDateAsc' ||
    value === 'dueDateAsc' ||
    value === 'customerNameAsc'
  ) {
    return value;
  }

  throw new InvoiceDraftValidationError('Invoice list sort is invalid.');
}

function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new InvoiceDraftValidationError(
      'Invoice list numeric query value is invalid.',
    );
  }

  return Number(value);
}

function parseOptionalValue(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
