import type {
  CustomerAuditAction,
  CustomerChangedFieldCategory,
} from './customerAuditEvent.js';

export interface CustomerHistoryEntry {
  action: CustomerAuditAction;
  changeCategories: readonly CustomerChangedFieldCategory[];
  id: string;
  occurredAt: string;
}

export interface CustomerHistoryPage {
  activityEntries: CustomerHistoryEntry[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  pageSize: number;
}
