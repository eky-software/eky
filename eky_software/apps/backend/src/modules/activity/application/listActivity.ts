import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type {
  ActivityItem,
  ActivityItemType,
} from '../domain/activityItem.js';
import type { CompanySettingsActivityReader } from '../../companySettings/ports/companySettingsActivityReader.js';
import type { CustomerActivityReader } from '../../customers/ports/customerActivityReader.js';
import type {
  InvoiceActivityAction,
} from '../../invoicing/domain/invoiceActivityEntry.js';
import type { InvoiceActivityReader } from '../../invoicing/ports/invoiceActivityReader.js';

export const defaultActivityLimit = 50;
export const maximumActivityLimit = 100;

export interface ListActivityInput {
  actorContext: ActorContext;
  limit?: number;
}

export interface ListActivityDependencies {
  companySettingsActivityReader: CompanySettingsActivityReader;
  customerActivityReader: CustomerActivityReader;
  invoiceActivityReader: InvoiceActivityReader;
}

export class ActivityValidationError extends Error {
  readonly code = 'activity_validation_error';

  constructor(message: string) {
    super(message);
    this.name = 'ActivityValidationError';
  }
}

export async function listActivity(
  input: ListActivityInput,
  dependencies: ListActivityDependencies,
): Promise<ActivityItem[]> {
  requirePermission(input.actorContext, 'viewActivity');
  const limit = validateLimit(input.limit);
  const companyId = input.actorContext.companyId;
  const [customerEntries, companySettingsEntries, invoiceEntries] =
    await Promise.all([
      dependencies.customerActivityReader.listCustomerActivity(companyId, limit),
      dependencies.companySettingsActivityReader.listCompanySettingsActivity(
        companyId,
        limit,
      ),
      dependencies.invoiceActivityReader.listInvoiceActivity(companyId, limit),
    ]);

  return [
    ...customerEntries.map<ActivityItem>((entry) => ({
      id: `customers:${entry.id}`,
      module: 'customers',
      occurredAt: entry.occurredAt,
      reference:
        entry.customerNumber === null
          ? null
          : { kind: 'customerNumber', value: entry.customerNumber },
      type: entry.action,
    })),
    ...companySettingsEntries.map<ActivityItem>((entry) => ({
      id: `companySettings:${entry.id}`,
      module: 'companySettings',
      occurredAt: entry.occurredAt,
      reference: null,
      type: entry.action,
    })),
    ...invoiceEntries.map<ActivityItem>((entry) => ({
      id: `invoicing:${entry.id}`,
      module: 'invoicing',
      occurredAt: entry.occurredAt,
      reference: { kind: 'invoiceNumber', value: entry.invoiceNumber },
      type: mapInvoiceAction(entry.action),
    })),
  ]
    .sort(compareActivityItems)
    .slice(0, limit);
}

function validateLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return defaultActivityLimit;
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximumActivityLimit
  ) {
    throw new ActivityValidationError(
      `Activity limit must be an integer between 1 and ${maximumActivityLimit}.`,
    );
  }
  return limit;
}

function compareActivityItems(left: ActivityItem, right: ActivityItem): number {
  const timeComparison = right.occurredAt.localeCompare(left.occurredAt);
  return timeComparison === 0 ? right.id.localeCompare(left.id) : timeComparison;
}

function mapInvoiceAction(action: InvoiceActivityAction): ActivityItemType {
  const actions: Record<InvoiceActivityAction, ActivityItemType> = {
    'invoice.approved': 'invoice.approved',
    'invoice.cancelled': 'invoice.cancelled',
    'invoice.credit_approved': 'invoice.creditApproved',
    'invoice.credit_draft_created': 'invoice.creditDraftCreated',
    'invoice.credit_reapproved': 'invoice.creditReapproved',
    'invoice.delivered': 'invoice.delivered',
    'invoice.reapproved': 'invoice.reapproved',
    'invoice.reopened_for_edit': 'invoice.reopenedForEdit',
  };

  return actions[action];
}
