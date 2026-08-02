import type { ListApprovedInvoicesInput } from '../application/listApprovedInvoices.js';
import type { ListSentInvoiceGroupsInput } from '../application/listSentInvoiceGroups.js';
import { normalizeInvoiceListCustomerFilters } from '../application/invoiceListCustomerFilter.js';
import {
  isApprovedInvoiceListPageSize,
  type ApprovedInvoiceListSort,
} from '../domain/approvedInvoiceSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';

const allowedFields = new Set([
  'status',
  'customerId',
  'billingRecipientCustomerId',
  'dateFrom',
  'dateTo',
  'page',
  'pageSize',
  'sort',
]);
const sentGroupAllowedFields = new Set([
  ...allowedFields,
  'creditState',
  'paymentState',
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
  const { billingRecipientCustomerId, customerId } =
    normalizeInvoiceListCustomerFilters({
      ...(query.customerId === undefined
        ? {}
        : { customerId: query.customerId }),
      ...(query.billingRecipientCustomerId === undefined
        ? {}
        : {
            billingRecipientCustomerId:
              query.billingRecipientCustomerId,
          }),
    });

  const pageSize = parseInteger(query.pageSize, 20);

  if (!isApprovedInvoiceListPageSize(pageSize)) {
    throw new InvoiceDraftValidationError(
      'Invoice list page size is invalid.',
    );
  }

  return {
    companyId,
    status: parseStatus(query.status),
    page: parseInteger(query.page, 1),
    pageSize,
    sort: parseSort(query.sort),
    ...(customerId === null ? {} : { customerId }),
    ...(billingRecipientCustomerId === null
      ? {}
      : { billingRecipientCustomerId }),
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

  const { creditState, paymentState, ...listQuery } = query;
  const { status: _status, ...input } = parseApprovedInvoiceListRequest(
    companyId,
    { ...listQuery, status: 'sent' },
  );

  return {
    ...input,
    creditState: parseSentInvoiceCreditState(creditState),
    paymentState: parseSentInvoicePaymentState(paymentState),
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

function parseSentInvoicePaymentState(
  value: string | undefined,
): 'all' | 'unpaid' | 'paid' {
  if (value === undefined || value === 'all') {
    return 'all';
  }

  if (value === 'unpaid' || value === 'paid') {
    return value;
  }

  throw new InvoiceDraftValidationError(
    'Sent invoice group payment state is invalid.',
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
