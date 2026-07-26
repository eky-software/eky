export type ActivityItemType =
  | 'companySettings.updated'
  | 'customer.activated'
  | 'customer.created'
  | 'customer.deactivated'
  | 'customer.updated'
  | 'invoice.approved'
  | 'invoice.cancelled'
  | 'invoice.creditApproved'
  | 'invoice.creditDraftCreated'
  | 'invoice.creditReapproved'
  | 'invoice.delivered'
  | 'invoice.reapproved'
  | 'invoice.reopenedForEdit';

export type ActivityModule = 'companySettings' | 'customers' | 'invoicing';

export interface ActivityItemReference {
  kind: 'customerNumber' | 'invoiceNumber';
  value: string;
}

export interface ActivityItem {
  id: string;
  module: ActivityModule;
  occurredAt: string;
  reference: ActivityItemReference | null;
  type: ActivityItemType;
}
