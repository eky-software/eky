import { randomUUID } from 'node:crypto';

import type { ActorContext } from '@eky/auth';

import { createCustomerRecord, type Customer } from '../domain/customer.js';
import { createCustomerCreatedAuditEvent } from '../domain/customerAuditEvent.js';
import {
  CustomerValidationError,
  normalizeCustomerComment,
  normalizeCustomerName,
  normalizeCustomerNumber,
  normalizeManagedByCustomerId,
  normalizeOptionalCustomerField,
  parseCustomerHourlyRateOverrideCents,
  parseCustomerNumberMode,
  parseCustomerStatus,
  parseCustomerType,
} from '../domain/customerRules.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

export interface CreateCustomerInput {
  businessId: string;
  city: string;
  comment: string;
  actorContext: ActorContext;
  customerNumber?: string;
  customerNumberMode: string;
  customerType: string;
  email: string;
  hourlyRateOverrideCents: unknown;
  managedByCustomerId: string;
  name: string;
  phone: string;
  postalCode: string;
  status: string;
  streetAddress: string;
}

export async function createCustomer(
  input: CreateCustomerInput,
  customerRepository: CustomerRepository,
): Promise<Customer> {
  const customerNumberMode = parseCustomerNumberMode(input.customerNumberMode);
  const customerNumber =
    customerNumberMode === 'auto'
      ? await customerRepository.getNextCustomerNumber(
          input.actorContext.companyId,
        )
      : normalizeCustomerNumber(input.customerNumber ?? '');
  const customerType = parseCustomerType(input.customerType);
  const managedByCustomerId = normalizeManagedByCustomerId(input.managedByCustomerId, customerType);

  if (managedByCustomerId.length > 0) {
    const propertyManager = await customerRepository.findById(
      input.actorContext.companyId,
      managedByCustomerId,
    );

    if (propertyManager?.customerType !== 'propertyManager') {
      throw new CustomerValidationError('Managed by customer must be a property manager.');
    }
  }

  const customer = createCustomerRecord({
    id: randomUUID(),
    businessId: normalizeOptionalCustomerField(input.businessId, 'Customer business id'),
    city: normalizeOptionalCustomerField(input.city, 'Customer city'),
    comment: normalizeCustomerComment(input.comment),
    companyId: input.actorContext.companyId,
    customerNumber,
    customerType,
    email: normalizeOptionalCustomerField(input.email, 'Customer email'),
    hourlyRateOverrideCents: parseCustomerHourlyRateOverrideCents(input.hourlyRateOverrideCents),
    managedByCustomerId,
    name: normalizeCustomerName(input.name),
    now: new Date().toISOString(),
    phone: normalizeOptionalCustomerField(input.phone, 'Customer phone'),
    postalCode: normalizeOptionalCustomerField(input.postalCode, 'Customer postal code'),
    status: parseCustomerStatus(input.status),
    streetAddress: normalizeOptionalCustomerField(input.streetAddress, 'Customer street address'),
  });

  return customerRepository.create(
    customer,
    createCustomerCreatedAuditEvent({
      actorUserId: input.actorContext.actorId,
      customer,
    }),
  );
}
