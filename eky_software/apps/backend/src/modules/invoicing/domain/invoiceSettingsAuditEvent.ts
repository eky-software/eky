import { randomUUID } from 'node:crypto';

export type InvoiceSettingsAuditAction =
  | 'invoiceNumberingSettings.updated'
  | 'invoicePaymentSettings.updated'
  | 'invoiceVatRates.updated';

export interface InvoiceSettingsAuditEvent {
  action: InvoiceSettingsAuditAction;
  actorUserId: string;
  companyId: string;
  id: string;
  occurredAt: string;
  outcome: 'success';
}

export function createInvoiceSettingsAuditEvent(input: {
  action: InvoiceSettingsAuditAction;
  actorUserId: string;
  companyId: string;
  occurredAt: string;
}): InvoiceSettingsAuditEvent {
  return Object.freeze({
    ...input,
    id: randomUUID(),
    outcome: 'success',
  });
}
