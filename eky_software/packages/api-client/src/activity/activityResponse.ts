import { EkyApiError, isRecord } from '../http.js';
import type {
  ActivityItem,
  ActivityItemReference,
  ActivityItemType,
  ActivityModule,
} from './activityTypes.js';

const activityItemTypes = new Set<ActivityItemType>([
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
  'invoice.reapproved',
  'invoice.reopenedForEdit',
]);
const activityModules = new Set<ActivityModule>([
  'companySettings',
  'customers',
  'invoicing',
]);

export function readActivityResponse(value: unknown): ActivityItem[] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['activityItems']) ||
    !Array.isArray(value.activityItems)
  ) {
    throw invalidResponse(value);
  }

  return value.activityItems.map(parseActivityItem);
}

function parseActivityItem(value: unknown): ActivityItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'module', 'occurredAt', 'reference', 'type']) ||
    !isBoundedText(value.id, 1, 240) ||
    !isActivityModule(value.module) ||
    !isIsoTimestamp(value.occurredAt) ||
    !isActivityItemType(value.type)
  ) {
    throw invalidResponse(value);
  }

  return {
    id: value.id,
    module: value.module,
    occurredAt: value.occurredAt,
    reference: parseReference(value.reference),
    type: value.type,
  };
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

function isIsoTimestamp(value: unknown): value is string {
  return (
    isBoundedText(value, 20, 40) &&
    Number.isFinite(Date.parse(value)) &&
    value.endsWith('Z')
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
