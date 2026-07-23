import type {
  ApprovedInvoiceListSort,
  ApprovedInvoiceSummary,
} from './approvedInvoiceSummary.js';

export type SentInvoiceCreditStatus = 'none' | 'partial' | 'full';

export interface SentInvoiceGroup {
  rootInvoice: ApprovedInvoiceSummary;
  creditInvoices: ApprovedInvoiceSummary[];
  creditStatus: SentInvoiceCreditStatus;
  remainingCreditableGrossCents: number;
}

export interface SentInvoiceGroupQuery {
  companyId: string;
  dateFrom: string | null;
  dateTo: string | null;
  limit: number;
  offset: number;
  sort: ApprovedInvoiceListSort;
}

export interface SentInvoiceGroupResult {
  groups: SentInvoiceGroup[];
  totalCount: number;
}

export interface SentInvoiceGroupListPage {
  groups: SentInvoiceGroup[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}
