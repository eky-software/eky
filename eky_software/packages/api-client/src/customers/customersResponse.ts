import { EkyApiError, isRecord } from '../http.js';
import type {
  Customer,
  CustomerActivityAction,
  CustomerActivityChangeCategory,
  CustomerActivityEntry,
  CustomerActivityPage,
  CustomerStatus,
  CustomerType,
} from './customersTypes.js';

const customerKeys = new Set([
  'businessId',
  'city',
  'comment',
  'companyId',
  'createdAt',
  'customerNumber',
  'customerType',
  'email',
  'hourlyRateOverrideCents',
  'id',
  'managedByCustomerId',
  'name',
  'phone',
  'postalCode',
  'status',
  'streetAddress',
  'updatedAt',
]);
const activityPageKeys = new Set([
  'activityEntries',
  'hasNextPage',
  'hasPreviousPage',
  'page',
  'pageSize',
]);
const activityEntryKeys = new Set([
  'action',
  'changeCategories',
  'id',
  'occurredAt',
]);

export function parseCustomer(value: unknown): Customer {
  if (
    !isRecord(value) ||
    hasUnknownKeys(value, customerKeys) ||
    typeof value.id !== 'string' ||
    typeof value.companyId !== 'string' ||
    typeof value.customerNumber !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.customerType !== 'string' ||
    typeof value.businessId !== 'string' ||
    typeof value.streetAddress !== 'string' ||
    typeof value.postalCode !== 'string' ||
    typeof value.city !== 'string' ||
    typeof value.email !== 'string' ||
    typeof value.managedByCustomerId !== 'string' ||
    typeof value.phone !== 'string' ||
    typeof value.comment !== 'string' ||
    !isNullableNumber(value.hourlyRateOverrideCents) ||
    typeof value.status !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw invalidCustomerResponse(value);
  }

  return {
    id: value.id,
    companyId: value.companyId,
    customerNumber: value.customerNumber,
    name: value.name,
    customerType: parseCustomerType(value.customerType),
    businessId: value.businessId,
    streetAddress: value.streetAddress,
    postalCode: value.postalCode,
    city: value.city,
    email: value.email,
    managedByCustomerId: value.managedByCustomerId,
    phone: value.phone,
    comment: value.comment,
    hourlyRateOverrideCents: value.hourlyRateOverrideCents,
    status: parseCustomerStatus(value.status),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseCustomerActivityPage(
  value: unknown,
): CustomerActivityPage {
  if (
    !isRecord(value) ||
    hasUnknownKeys(value, activityPageKeys) ||
    !Array.isArray(value.activityEntries) ||
    typeof value.hasNextPage !== 'boolean' ||
    typeof value.hasPreviousPage !== 'boolean' ||
    !isIntegerInRange(value.page, 1, 100) ||
    (value.pageSize !== 20 && value.pageSize !== 50) ||
    value.activityEntries.length > value.pageSize ||
    value.hasPreviousPage !== (value.page > 1)
  ) {
    throw invalidCustomerActivityResponse(value);
  }

  return {
    activityEntries: value.activityEntries.map(parseCustomerActivityEntry),
    hasNextPage: value.hasNextPage,
    hasPreviousPage: value.hasPreviousPage,
    page: value.page,
    pageSize: value.pageSize,
  };
}

function parseCustomerActivityEntry(value: unknown): CustomerActivityEntry {
  if (
    !isRecord(value) ||
    hasUnknownKeys(value, activityEntryKeys) ||
    typeof value.action !== 'string' ||
    !Array.isArray(value.changeCategories) ||
    value.changeCategories.length > 5 ||
    !value.changeCategories.every(
      (category): category is CustomerActivityChangeCategory =>
        typeof category === 'string' &&
        isCustomerActivityChangeCategory(category),
    ) ||
    new Set(value.changeCategories).size !== value.changeCategories.length ||
    typeof value.id !== 'string' ||
    typeof value.occurredAt !== 'string'
  ) {
    throw invalidCustomerActivityResponse(value);
  }

  return {
    action: parseCustomerActivityAction(value.action),
    changeCategories: [...value.changeCategories],
    id: value.id,
    occurredAt: value.occurredAt,
  };
}

function hasUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).some((key) => !allowedKeys.has(key));
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function parseCustomerStatus(value: string): CustomerStatus {
  if (value === 'active' || value === 'inactive') {
    return value;
  }

  throw invalidCustomerResponse(value);
}

function parseCustomerType(value: string): CustomerType {
  if (
    value === 'company' ||
    value === 'housingCompany' ||
    value === 'other' ||
    value === 'privatePerson' ||
    value === 'propertyManager'
  ) {
    return value;
  }

  throw invalidCustomerResponse(value);
}

function parseCustomerActivityAction(value: string): CustomerActivityAction {
  if (
    value === 'customer.activated' ||
    value === 'customer.created' ||
    value === 'customer.deactivated' ||
    value === 'customer.updated'
  ) {
    return value;
  }

  throw invalidCustomerActivityResponse(value);
}

function isCustomerActivityChangeCategory(
  value: string,
): value is CustomerActivityChangeCategory {
  return (
    value === 'billing' ||
    value === 'contact' ||
    value === 'identity' ||
    value === 'pricing' ||
    value === 'status'
  );
}

function invalidCustomerResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid customer response.', { responseBody });
}

function invalidCustomerActivityResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid customer activity response.', {
    responseBody,
  });
}
