import type { CompanySettingsAuditRetentionPort } from '../../modules/companySettings/ports/companySettingsAuditRetentionPort.js';
import type { CustomerAuditRetentionPort } from '../../modules/customers/ports/customerAuditRetentionPort.js';
import type { InvoiceSettingsAuditRetentionPort } from '../../modules/invoicing/ports/invoiceSettingsAuditRetentionPort.js';

const completeCalendarYearsToKeep = 7;

export interface MaintainBusinessAuditRetentionDependencies {
  companySettingsAuditRetention: CompanySettingsAuditRetentionPort;
  customerAuditRetention: CustomerAuditRetentionPort;
  invoiceSettingsAuditRetention: InvoiceSettingsAuditRetentionPort;
}

export interface BusinessAuditRetentionResult {
  cutoff: string;
  deletedEventCount: number;
}

export async function maintainBusinessAuditRetention(
  now: Date,
  dependencies: MaintainBusinessAuditRetentionDependencies,
): Promise<BusinessAuditRetentionResult> {
  const cutoff = getBusinessAuditRetentionCutoff(now);
  const deletedEventCounts = await Promise.all([
    dependencies.customerAuditRetention.deleteCustomerAuditEventsBefore(cutoff),
    dependencies.companySettingsAuditRetention
      .deleteCompanySettingsAuditEventsBefore(cutoff),
    dependencies.invoiceSettingsAuditRetention
      .deleteInvoiceSettingsAuditEventsBefore(cutoff),
  ]);

  return {
    cutoff,
    deletedEventCount: deletedEventCounts.reduce(
      (total, count) => total + count,
      0,
    ),
  };
}

export function getBusinessAuditRetentionCutoff(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new Error('Business audit retention date is invalid.');
  }

  return new Date(
    Date.UTC(now.getUTCFullYear() - completeCalendarYearsToKeep, 0, 1),
  ).toISOString();
}
