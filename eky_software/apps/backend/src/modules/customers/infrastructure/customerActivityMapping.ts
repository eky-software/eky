import type { CustomerChangedFieldCategory } from '../domain/customerAuditEvent.js';

const customerChangeCategories = new Set<CustomerChangedFieldCategory>([
  'billing',
  'contact',
  'identity',
  'pricing',
  'status',
]);

export function readCustomerChangeCategories(
  value: string,
): readonly CustomerChangedFieldCategory[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('CUSTOMER_ACTIVITY_CHANGE_CATEGORIES_INVALID');
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length > customerChangeCategories.size ||
    !parsed.every(
      (category): category is CustomerChangedFieldCategory =>
        typeof category === 'string' &&
        customerChangeCategories.has(category as CustomerChangedFieldCategory),
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error('CUSTOMER_ACTIVITY_CHANGE_CATEGORIES_INVALID');
  }

  return Object.freeze([...parsed]);
}
