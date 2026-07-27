export type ActivityItemType =
  | 'companyEmailSecret.configured'
  | 'companyEmailSecret.removed'
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
  | 'invoice.deliveryFailed'
  | 'invoice.deliveryOutcomeUnknown'
  | 'invoice.deliveryPending'
  | 'invoiceNumberingSettings.updated'
  | 'invoicePaymentSettings.updated'
  | 'invoice.reapproved'
  | 'invoice.reopenedForEdit'
  | 'invoiceVatRates.updated';

export type ActivityModule = 'companySettings' | 'customers' | 'invoicing';
export type ActivityCategory = 'all' | ActivityModule;
export type ActivityOutcome = 'blocked' | 'failure' | 'success' | 'unknown';
export type ActivityOutcomeFilter = 'all' | ActivityOutcome;

export interface ActivityItemReference {
  kind: 'customerNumber' | 'invoiceNumber';
  value: string;
}

export interface ActivityItem {
  id: string;
  module: ActivityModule;
  occurredAt: string;
  outcome: ActivityOutcome;
  reference: ActivityItemReference | null;
  type: ActivityItemType;
}

export interface ActivityPage {
  activityItems: ActivityItem[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  month: string;
  page: number;
  pageSize: number;
}
