import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CompanySettingsActivityReader } from '../../companySettings/ports/companySettingsActivityReader.js';
import type { CustomerActivityReader } from '../../customers/ports/customerActivityReader.js';
import type {
  InvoiceActivityAction,
  InvoiceActivityOutcome,
} from '../../invoicing/domain/invoiceActivityEntry.js';
import type { InvoiceActivityReader } from '../../invoicing/ports/invoiceActivityReader.js';
import type {
  ActivityCategory,
  ActivityItem,
  ActivityItemType,
  ActivityOutcomeFilter,
  ActivityPage,
} from '../domain/activityItem.js';
import {
  formatHelsinkiCalendarMonth,
  getHelsinkiCalendarMonthUtcRange,
  isActivityCalendarMonth,
} from './helsinkiCalendarMonth.js';

export const defaultActivityPage = 1;
export const defaultActivityPageSize = 20;
export const maximumActivityPage = 100;
export const activityPageSizes = [20, 50, 100] as const;

export interface ListActivityInput {
  actorContext: ActorContext;
  category?: ActivityCategory;
  month?: string;
  outcome?: ActivityOutcomeFilter;
  page?: number;
  pageSize?: number;
}

export interface ListActivityDependencies {
  companySettingsActivityReader: CompanySettingsActivityReader;
  customerActivityReader: CustomerActivityReader;
  invoiceActivityReader: InvoiceActivityReader;
  now?: () => Date;
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
): Promise<ActivityPage> {
  requirePermission(input.actorContext, 'viewActivity');
  const query = validateQuery(input, dependencies.now?.() ?? new Date());
  const range = getHelsinkiCalendarMonthUtcRange(query.month);
  const readerLimit = query.page * query.pageSize + 1;
  const companyId = input.actorContext.companyId;
  const invoiceOutcomes = getInvoiceOutcomes(query.outcome);

  const [customerEntries, companySettingsEntries, invoiceEntries] =
    await Promise.all([
      shouldReadCategory(query.category, 'customers') &&
      includesSuccess(query.outcome)
        ? dependencies.customerActivityReader.listCustomerActivity({
            companyId,
            limit: readerLimit,
            occurredAtFrom: range.from,
            occurredAtTo: range.to,
          })
        : [],
      shouldReadCategory(query.category, 'companySettings') &&
      includesSuccess(query.outcome)
        ? dependencies.companySettingsActivityReader.listCompanySettingsActivity({
            companyId,
            limit: readerLimit,
            occurredAtFrom: range.from,
            occurredAtTo: range.to,
          })
        : [],
      shouldReadCategory(query.category, 'invoicing') &&
      invoiceOutcomes.length > 0
        ? dependencies.invoiceActivityReader.listInvoiceActivity({
            companyId,
            limit: readerLimit,
            occurredAtFrom: range.from,
            occurredAtTo: range.to,
            outcomes: invoiceOutcomes,
          })
        : [],
    ]);

  const sortedItems = [
    ...customerEntries.map<ActivityItem>((entry) => ({
      ...(entry.changeCategories.length === 0
        ? {}
        : { changeCategories: entry.changeCategories }),
      id: `customers:${entry.id}`,
      module: 'customers',
      occurredAt: entry.occurredAt,
      outcome: 'success',
      reference:
        entry.customerNumber === null
          ? null
          : { kind: 'customerNumber', value: entry.customerNumber },
      type: entry.action,
    })),
    ...companySettingsEntries.map<ActivityItem>((entry) => ({
      ...(entry.changeCategories.length === 0
        ? {}
        : { changeCategories: entry.changeCategories }),
      id: `companySettings:${entry.id}`,
      module: 'companySettings',
      occurredAt: entry.occurredAt,
      outcome: 'success',
      reference: null,
      type: entry.action,
    })),
    ...invoiceEntries.map<ActivityItem>((entry) => ({
      id: `invoicing:${entry.id}`,
      module: 'invoicing',
      occurredAt: entry.occurredAt,
      outcome: entry.outcome,
      reference:
        entry.invoiceNumber === null
          ? null
          : { kind: 'invoiceNumber', value: entry.invoiceNumber },
      type: mapInvoiceAction(entry.action),
    })),
  ].sort(compareActivityItems);
  const offset = (query.page - 1) * query.pageSize;

  return {
    activityItems: sortedItems.slice(offset, offset + query.pageSize),
    hasNextPage: sortedItems.length > offset + query.pageSize,
    hasPreviousPage: query.page > 1,
    month: query.month,
    page: query.page,
    pageSize: query.pageSize,
  };
}

interface ValidatedActivityQuery {
  category: ActivityCategory;
  month: string;
  outcome: ActivityOutcomeFilter;
  page: number;
  pageSize: number;
}

function validateQuery(
  input: ListActivityInput,
  now: Date,
): ValidatedActivityQuery {
  const category = input.category ?? 'all';
  const month = input.month ?? formatHelsinkiCalendarMonth(now);
  const outcome = input.outcome ?? 'all';
  const page = input.page ?? defaultActivityPage;
  const pageSize = input.pageSize ?? defaultActivityPageSize;

  if (!isActivityCategory(category)) {
    throw new ActivityValidationError('Activity category is invalid.');
  }
  if (!isActivityCalendarMonth(month)) {
    throw new ActivityValidationError('Activity month is invalid.');
  }
  if (!isActivityOutcomeFilter(outcome)) {
    throw new ActivityValidationError('Activity outcome is invalid.');
  }
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > maximumActivityPage
  ) {
    throw new ActivityValidationError(
      `Activity page must be an integer between 1 and ${maximumActivityPage}.`,
    );
  }
  if (!activityPageSizes.includes(pageSize as (typeof activityPageSizes)[number])) {
    throw new ActivityValidationError('Activity page size is invalid.');
  }

  return { category, month, outcome, page, pageSize };
}

function isActivityCategory(value: string): value is ActivityCategory {
  return (
    value === 'all' ||
    value === 'companySettings' ||
    value === 'customers' ||
    value === 'invoicing'
  );
}

function isActivityOutcomeFilter(
  value: string,
): value is ActivityOutcomeFilter {
  return (
    value === 'all' ||
    value === 'blocked' ||
    value === 'failure' ||
    value === 'success' ||
    value === 'unknown'
  );
}

function shouldReadCategory(
  selected: ActivityCategory,
  candidate: Exclude<ActivityCategory, 'all'>,
): boolean {
  return selected === 'all' || selected === candidate;
}

function includesSuccess(outcome: ActivityOutcomeFilter): boolean {
  return outcome === 'all' || outcome === 'success';
}

function getInvoiceOutcomes(
  outcome: ActivityOutcomeFilter,
): InvoiceActivityOutcome[] {
  if (outcome === 'all') {
    return ['success', 'failure', 'unknown'];
  }
  if (outcome === 'blocked') {
    return [];
  }
  return [outcome];
}

function compareActivityItems(left: ActivityItem, right: ActivityItem): number {
  const timeComparison = right.occurredAt.localeCompare(left.occurredAt);
  return timeComparison === 0 ? right.id.localeCompare(left.id) : timeComparison;
}

function mapInvoiceAction(action: InvoiceActivityAction): ActivityItemType {
  const actions: Record<InvoiceActivityAction, ActivityItemType> = {
    'invoiceNumberingSettings.updated': 'invoiceNumberingSettings.updated',
    'invoicePaymentSettings.updated': 'invoicePaymentSettings.updated',
    'invoiceVatRates.updated': 'invoiceVatRates.updated',
    'invoice.approved': 'invoice.approved',
    'invoice.cancelled': 'invoice.cancelled',
    'invoice.credit_approved': 'invoice.creditApproved',
    'invoice.credit_draft_created': 'invoice.creditDraftCreated',
    'invoice.credit_reapproved': 'invoice.creditReapproved',
    'invoice.delivered': 'invoice.delivered',
    'invoice.delivery_failed': 'invoice.deliveryFailed',
    'invoice.delivery_outcome_unknown': 'invoice.deliveryOutcomeUnknown',
    'invoice.delivery_pending': 'invoice.deliveryPending',
    'invoice.reapproved': 'invoice.reapproved',
    'invoice.reopened_for_edit': 'invoice.reopenedForEdit',
  };

  return actions[action];
}
