import type { ListApprovedInvoicesInput } from '../application/listApprovedInvoices.js';
import type { ListSentInvoiceGroupsInput } from '../application/listSentInvoiceGroups.js';
import type { ApprovedInvoiceListSort } from '../domain/approvedInvoiceSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

const allowedFields = new Set([
  'status',
  'dateFrom',
  'dateTo',
  'page',
  'pageSize',
  'sort',
]);

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

  return {
    companyId,
    status: parseStatus(query.status),
    page: parseInteger(query.page, 1),
    pageSize: parseInteger(query.pageSize, 20),
    sort: parseSort(query.sort),
    ...(dateFrom === undefined ? {} : { dateFrom }),
    ...(dateTo === undefined ? {} : { dateTo }),
  };
}

export function parseSentInvoiceGroupListRequest(
  companyId: string,
  query: Record<string, string>,
): ListSentInvoiceGroupsInput {
  if ('status' in query) {
    throw new InvoiceDraftValidationError(
      'Sent invoice group query contains an unsupported field.',
    );
  }

  const { status: _status, ...input } = parseApprovedInvoiceListRequest(
    companyId,
    { ...query, status: 'sent' },
  );

  return input;
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
