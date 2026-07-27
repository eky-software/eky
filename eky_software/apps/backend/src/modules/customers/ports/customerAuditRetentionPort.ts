export interface CustomerAuditRetentionPort {
  deleteCustomerAuditEventsBefore(cutoff: string): Promise<number>;
}
