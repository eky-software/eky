import { randomUUID } from 'node:crypto';

import type { Customer } from './customer.js';

export type CustomerAuditAction =
  | 'customer.activated'
  | 'customer.created'
  | 'customer.deactivated'
  | 'customer.updated';

export type CustomerChangedFieldCategory =
  | 'billing'
  | 'contact'
  | 'identity'
  | 'pricing'
  | 'status';

export interface CustomerAuditEvent {
  action: CustomerAuditAction;
  actorUserId: string;
  changedFieldCategories: readonly CustomerChangedFieldCategory[];
  companyId: string;
  customerId: string;
  id: string;
  occurredAt: string;
  outcome: 'success';
}

const allCustomerCategories = Object.freeze([
  'identity',
  'contact',
  'billing',
  'pricing',
  'status',
] satisfies CustomerChangedFieldCategory[]);

export function createCustomerCreatedAuditEvent(input: {
  actorUserId: string;
  customer: Customer;
}): CustomerAuditEvent {
  return createEvent({
    action: 'customer.created',
    actorUserId: input.actorUserId,
    categories: allCustomerCategories,
    customer: input.customer,
  });
}

export function createCustomerUpdatedAuditEvent(input: {
  actorUserId: string;
  current: Customer;
  updated: Customer;
}): CustomerAuditEvent {
  return createEvent({
    action: resolveUpdateAction(input.current, input.updated),
    actorUserId: input.actorUserId,
    categories: getChangedCategories(input.current, input.updated),
    customer: input.updated,
  });
}

function createEvent(input: {
  action: CustomerAuditAction;
  actorUserId: string;
  categories: readonly CustomerChangedFieldCategory[];
  customer: Customer;
}): CustomerAuditEvent {
  return Object.freeze({
    action: input.action,
    actorUserId: input.actorUserId,
    changedFieldCategories: Object.freeze([...input.categories]),
    companyId: input.customer.companyId,
    customerId: input.customer.id,
    id: randomUUID(),
    occurredAt: input.customer.updatedAt,
    outcome: 'success',
  });
}

function resolveUpdateAction(
  current: Customer,
  updated: Customer,
): CustomerAuditAction {
  if (current.status === 'inactive' && updated.status === 'active') {
    return 'customer.activated';
  }
  if (current.status === 'active' && updated.status === 'inactive') {
    return 'customer.deactivated';
  }
  return 'customer.updated';
}

function getChangedCategories(
  current: Customer,
  updated: Customer,
): CustomerChangedFieldCategory[] {
  const categories: CustomerChangedFieldCategory[] = [];

  if (
    current.businessId !== updated.businessId ||
    current.customerNumber !== updated.customerNumber ||
    current.customerType !== updated.customerType ||
    current.name !== updated.name
  ) {
    categories.push('identity');
  }
  if (
    current.city !== updated.city ||
    current.email !== updated.email ||
    current.phone !== updated.phone ||
    current.postalCode !== updated.postalCode ||
    current.streetAddress !== updated.streetAddress
  ) {
    categories.push('contact');
  }
  if (
    current.comment !== updated.comment ||
    current.managedByCustomerId !== updated.managedByCustomerId
  ) {
    categories.push('billing');
  }
  if (
    current.hourlyRateOverrideCents !== updated.hourlyRateOverrideCents
  ) {
    categories.push('pricing');
  }
  if (current.status !== updated.status) {
    categories.push('status');
  }

  return categories;
}
