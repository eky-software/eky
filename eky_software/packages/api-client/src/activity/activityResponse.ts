import { EkyApiError, isRecord } from '../http.js';
import type {
  ActivityChangeCategory,
  ActivityItem,
  ActivityItemReference,
  ActivityItemType,
  ActivityModule,
  ActivityOutcome,
  ActivityPage,
} from './activityTypes.js';

const activityItemTypes = new Set<ActivityItemType>([
  'companyEmailSecret.configured',
  'companyEmailSecret.removed',
  'companySettings.updated',
  'customer.activated',
  'customer.created',
  'customer.deactivated',
  'customer.updated',
  'invoice.approved',
  'invoice.cancelled',
  'invoice.creditApproved',
  'invoice.creditDraftCreated',
  'invoice.creditReapproved',
  'invoice.delivered',
  'invoice.deliveryFailed',
  'invoice.deliveryOutcomeUnknown',
  'invoice.deliveryPending',
  'invoice.paymentMarkReverted',
  'invoice.paymentMarkedPaid',
  'invoiceNumberingSettings.updated',
  'invoicePaymentSettings.updated',
  'invoice.reapproved',
  'invoice.reopenedForEdit',
  'invoiceVatRates.updated',
]);
const activityModules = new Set<ActivityModule>([
  'companySettings',
  'customers',
  'invoicing',
]);
const activityOutcomes = new Set<ActivityOutcome>([
  'blocked',
  'failure',
  'success',
  'unknown',
]);
const customerChangeCategories = new Set<ActivityChangeCategory>([
  'billing',
  'contact',
  'identity',
  'pricing',
  'status',
]);
const companySettingsChangeCategories = new Set<ActivityChangeCategory>([
  'address',
  'banking',
  'contact',
  'emailConfiguration',
  'identity',
  'invoicingDefaults',
]);

export function readActivityResponse(value: unknown): ActivityPage {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'activityItems',
      'hasNextPage',
      'hasPreviousPage',
      'month',
      'page',
      'pageSize',
    ]) ||
    !Array.isArray(value.activityItems) ||
    typeof value.hasNextPage !== 'boolean' ||
    typeof value.hasPreviousPage !== 'boolean' ||
    !isCalendarMonth(value.month) ||
    !isPositiveInteger(value.page, 100) ||
    !isPositiveInteger(value.pageSize, 100) ||
    ![20, 50, 100].includes(value.pageSize)
  ) {
    throw invalidResponse(value);
  }

  return {
    activityItems: value.activityItems.map(parseActivityItem),
    hasNextPage: value.hasNextPage,
    hasPreviousPage: value.hasPreviousPage,
    month: value.month,
    page: value.page,
    pageSize: value.pageSize,
  };
}

function parseActivityItem(value: unknown): ActivityItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'changeCategories',
      'id',
      'module',
      'occurredAt',
      'outcome',
      'reference',
      'type',
    ]) ||
    !isBoundedText(value.id, 1, 240) ||
    !isActivityModule(value.module) ||
    !isIsoTimestamp(value.occurredAt) ||
    !isActivityOutcome(value.outcome) ||
    !isActivityItemType(value.type)
  ) {
    throw invalidResponse(value);
  }

  const changeCategories = parseChangeCategories(
    value.changeCategories,
    value.module,
  );

  return {
    ...(changeCategories === undefined ? {} : { changeCategories }),
    id: value.id,
    module: value.module,
    occurredAt: value.occurredAt,
    outcome: value.outcome,
    reference: parseReference(value.reference),
    type: value.type,
  };
}

function parseChangeCategories(
  value: unknown,
  module: ActivityModule,
): readonly ActivityChangeCategory[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const allowedCategories =
    module === 'customers'
      ? customerChangeCategories
      : module === 'companySettings'
        ? companySettingsChangeCategories
        : undefined;

  if (
    allowedCategories === undefined ||
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > allowedCategories.size ||
    !value.every(
      (category): category is ActivityChangeCategory =>
        typeof category === 'string' &&
        allowedCategories.has(category as ActivityChangeCategory),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw invalidResponse(value);
  }

  return value;
}

function parseReference(value: unknown): ActivityItemReference | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['kind', 'value']) ||
    (value.kind !== 'customerNumber' && value.kind !== 'invoiceNumber') ||
    !isBoundedText(value.value, 1, 200)
  ) {
    throw invalidResponse(value);
  }
  return { kind: value.kind, value: value.value };
}

function isActivityItemType(value: unknown): value is ActivityItemType {
  return typeof value === 'string' && activityItemTypes.has(value as ActivityItemType);
}

function isActivityModule(value: unknown): value is ActivityModule {
  return typeof value === 'string' && activityModules.has(value as ActivityModule);
}

function isActivityOutcome(value: unknown): value is ActivityOutcome {
  return (
    typeof value === 'string' &&
    activityOutcomes.has(value as ActivityOutcome)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    isBoundedText(value, 20, 40) &&
    Number.isFinite(Date.parse(value)) &&
    value.endsWith('Z')
  );
}

function isCalendarMonth(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isPositiveInteger(value: unknown, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= maximum
  );
}

function isBoundedText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalidResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid activity response.', { responseBody });
}
