import type { ApprovedInvoiceListSort } from '../domain/approvedInvoiceSummary.js';
import type {
  SentInvoiceCreditStateFilter,
  SentInvoiceGroupListPage,
  SentInvoicePaymentStateFilter,
} from '../domain/sentInvoiceGroup.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { SentInvoiceGroupReader } from '../ports/sentInvoiceGroupReader.js';
import { normalizeInvoiceListCustomerFilters } from './invoiceListCustomerFilter.js';
import { validateApprovedInvoiceListInput } from './listApprovedInvoices.js';

export interface ListSentInvoiceGroupsInput {
  companyId: string;
  customerId?: string;
  billingRecipientCustomerId?: string;
  creditState?: SentInvoiceCreditStateFilter;
  paymentState?: SentInvoicePaymentStateFilter;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sort: ApprovedInvoiceListSort;
}

export async function listSentInvoiceGroups(
  input: ListSentInvoiceGroupsInput,
  reader: SentInvoiceGroupReader,
): Promise<SentInvoiceGroupListPage> {
  validateApprovedInvoiceListInput({ ...input, status: 'sent' });
  const { billingRecipientCustomerId, customerId } =
    normalizeInvoiceListCustomerFilters(input);
  const creditState = input.creditState ?? 'all';
  const paymentState = input.paymentState ?? 'all';

  if (
    creditState !== 'all' &&
    creditState !== 'uncredited' &&
    creditState !== 'credited'
  ) {
    throw new InvoiceDraftValidationError(
      'Sent invoice group credit state is invalid.',
    );
  }

  if (
    paymentState !== 'all' &&
    paymentState !== 'unpaid' &&
    paymentState !== 'paid'
  ) {
    throw new InvoiceDraftValidationError(
      'Sent invoice group payment state is invalid.',
    );
  }

  const offset = (input.page - 1) * input.pageSize;
  const result = await reader.listSentInvoiceGroups({
    companyId: input.companyId,
    customerId,
    billingRecipientCustomerId,
    creditState,
    paymentState,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    limit: input.pageSize,
    offset,
    sort: input.sort,
  });

  return {
    groups: result.groups,
    page: input.page,
    pageSize: input.pageSize,
    totalCount: result.totalCount,
    totalPages:
      result.totalCount === 0
        ? 0
        : Math.ceil(result.totalCount / input.pageSize),
  };
}
