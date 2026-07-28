import type {
  CustomerAuditAction,
  CustomerChangedFieldCategory,
} from './customerAuditEvent.js';

export interface CustomerActivityEntry {
  action: CustomerAuditAction;
  changeCategories: readonly CustomerChangedFieldCategory[];
  customerNumber: string | null;
  id: string;
  occurredAt: string;
}
