import type { ApprovedInvoiceListSort } from '../domain/approvedInvoiceSummary.js';
import type { SentInvoiceGroupListPage } from '../domain/sentInvoiceGroup.js';
import type { SentInvoiceGroupReader } from '../ports/sentInvoiceGroupReader.js';
import { validateApprovedInvoiceListInput } from './listApprovedInvoices.js';

export interface ListSentInvoiceGroupsInput {
  companyId: string;
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

  const offset = (input.page - 1) * input.pageSize;
  const result = await reader.listSentInvoiceGroups({
    companyId: input.companyId,
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
