import type { Customer } from '../domain/customer.js';
import {
  CustomerValidationError,
  normalizeCustomerComment,
  normalizeCustomerName,
  normalizeCustomerNumber,
  normalizeManagedByCustomerId,
  normalizeOptionalCustomerField,
  parseCustomerHourlyRateOverrideCents,
  parseCustomerStatus,
  parseCustomerType,
} from '../domain/customerRules.js';
import type { CustomerRepository } from '../ports/customerRepository.js';

export interface UpdateCustomerInput {
  businessId: string;
  city: string;
  comment: string;
  companyId: string;
  customerNumber: string;
  customerType: string;
  email: string;
  hourlyRateOverrideCents: unknown;
  id: string;
  managedByCustomerId: string;
  name: string;
  phone: string;
  postalCode: string;
  status: string;
  streetAddress: string;
}

export async function updateCustomer(
  input: UpdateCustomerInput,
  customerRepository: CustomerRepository,
): Promise<Customer> {
  const existingCustomer = await customerRepository.findById(input.companyId, input.id);

  if (existingCustomer === undefined) {
    throw new CustomerValidationError('Customer not found.');
  }

  const customerType = parseCustomerType(input.customerType);
  const managedByCustomerId = normalizeManagedByCustomerId(input.managedByCustomerId, customerType);

  if (managedByCustomerId.length > 0) {
    if (managedByCustomerId === existingCustomer.id) {
      throw new CustomerValidationError('Customer cannot manage itself.');
    }

    const propertyManager = await customerRepository.findById(input.companyId, managedByCustomerId);

    if (propertyManager?.customerType !== 'propertyManager') {
      throw new CustomerValidationError('Managed by customer must be a property manager.');
    }
  }

  const customer: Customer = {
    id: existingCustomer.id,
    businessId: normalizeOptionalCustomerField(input.businessId, 'Customer business id'),
    city: normalizeOptionalCustomerField(input.city, 'Customer city'),
    comment: normalizeCustomerComment(input.comment),
    companyId: existingCustomer.companyId,
    customerNumber: normalizeCustomerNumber(input.customerNumber),
    customerType,
    email: normalizeOptionalCustomerField(input.email, 'Customer email'),
    hourlyRateOverrideCents: parseCustomerHourlyRateOverrideCents(input.hourlyRateOverrideCents),
    managedByCustomerId,
    name: normalizeCustomerName(input.name),
    phone: normalizeOptionalCustomerField(input.phone, 'Customer phone'),
    postalCode: normalizeOptionalCustomerField(input.postalCode, 'Customer postal code'),
    status: parseCustomerStatus(input.status),
    streetAddress: normalizeOptionalCustomerField(input.streetAddress, 'Customer street address'),
    createdAt: existingCustomer.createdAt,
    updatedAt: new Date().toISOString(),
  };

  return customerRepository.update(customer);
}
