import type { CustomerAuditAction } from './customerAuditEvent.js';

export interface CustomerActivityEntry {
  action: CustomerAuditAction;
  customerNumber: string | null;
  id: string;
  occurredAt: string;
}
