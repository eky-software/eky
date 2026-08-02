import type { ApprovedInvoiceStatus } from '../domain/approvedInvoice.js';
import {
  isApprovedInvoiceListPageSize,
  type ApprovedInvoiceListPage,
  type ApprovedInvoiceListSort,
} from '../domain/approvedInvoiceSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import { normalizeInvoiceListCustomerFilters } from './invoiceListCustomerFilter.js';

const maximumCompanyIdLength = 120;
const maximumPage = 1_000_000;
const allowedSorts = new Set<ApprovedInvoiceListSort>([
  'invoiceDateDesc',
  'invoiceDateAsc',
  'dueDateAsc',
  'customerNameAsc',
]);

export interface ListApprovedInvoicesInput {
  companyId: string;
  customerId?: string;
  billingRecipientCustomerId?: string;
  status: ApprovedInvoiceStatus;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sort: ApprovedInvoiceListSort;
}

export async function listApprovedInvoices(
  input: ListApprovedInvoicesInput,
  approvedInvoiceReader: ApprovedInvoiceReader,
): Promise<ApprovedInvoiceListPage> {
  validateApprovedInvoiceListInput(input);
  const { billingRecipientCustomerId, customerId } =
    normalizeInvoiceListCustomerFilters(input);

  const offset = (input.page - 1) * input.pageSize;

  if (!Number.isSafeInteger(offset)) {
    throw new InvoiceDraftValidationError('Invoice list page is too large.');
  }

  const result = await approvedInvoiceReader.listApprovedInvoiceSummaries({
    companyId: input.companyId,
    customerId,
    billingRecipientCustomerId,
    status: input.status,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    limit: input.pageSize,
    offset,
    sort: input.sort,
  });

  return {
    invoices: result.invoices,
    page: input.page,
    pageSize: input.pageSize,
    totalCount: result.totalCount,
    totalPages:
      result.totalCount === 0
        ? 0
        : Math.ceil(result.totalCount / input.pageSize),
  };
}

export function validateApprovedInvoiceListInput(
  input: ListApprovedInvoicesInput,
): void {
  if (input.companyId.trim().length === 0) {
    throw new InvoiceDraftValidationError('Company id is required.');
  }

  if (input.companyId.length > maximumCompanyIdLength) {
    throw new InvoiceDraftValidationError('Company id is too long.');
  }

  if (
    input.status !== 'approved' &&
    input.status !== 'sent' &&
    input.status !== 'cancelled'
  ) {
    throw new InvoiceDraftValidationError('Invoice list status is invalid.');
  }

  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    input.page > maximumPage
  ) {
    throw new InvoiceDraftValidationError('Invoice list page is invalid.');
  }

  if (
    !Number.isSafeInteger(input.pageSize) ||
    !isApprovedInvoiceListPageSize(input.pageSize)
  ) {
    throw new InvoiceDraftValidationError('Invoice list page size is invalid.');
  }

  if (!allowedSorts.has(input.sort)) {
    throw new InvoiceDraftValidationError('Invoice list sort is invalid.');
  }

  if (input.dateFrom !== undefined) {
    validateIsoDate(input.dateFrom, 'Invoice list start date');
  }

  if (input.dateTo !== undefined) {
    validateIsoDate(input.dateTo, 'Invoice list end date');
  }

  if (
    input.dateFrom !== undefined &&
    input.dateTo !== undefined &&
    input.dateFrom > input.dateTo
  ) {
    throw new InvoiceDraftValidationError(
      'Invoice list start date must not be after end date.',
    );
  }
}

function validateIsoDate(value: string, fieldName: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) {
    throw new InvoiceDraftValidationError(`${fieldName} is invalid.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvoiceDraftValidationError(`${fieldName} is invalid.`);
  }
}
