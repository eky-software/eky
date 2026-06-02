import type { CustomerNumberMode, CustomerStatus, CustomerType } from './customer.js';

export class CustomerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerValidationError';
  }
}

export function normalizeCustomerName(name: string): string {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new CustomerValidationError('Customer name is required.');
  }

  if (normalizedName.length > 200) {
    throw new CustomerValidationError('Customer name must be 200 characters or less.');
  }

  return normalizedName;
}

export function normalizeOptionalCustomerField(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length > 200) {
    throw new CustomerValidationError(`${fieldName} must be 200 characters or less.`);
  }

  return normalizedValue;
}

export function normalizeCustomerComment(comment: string): string {
  const normalizedComment = comment.trim();

  if (normalizedComment.length > 1000) {
    throw new CustomerValidationError('Customer comment must be 1000 characters or less.');
  }

  return normalizedComment;
}

export function normalizeCustomerNumber(customerNumber: string): string {
  const normalizedCustomerNumber = customerNumber.trim();

  if (normalizedCustomerNumber.length === 0) {
    throw new CustomerValidationError('Customer number is required.');
  }

  if (normalizedCustomerNumber.length > 50) {
    throw new CustomerValidationError('Customer number must be 50 characters or less.');
  }

  return normalizedCustomerNumber;
}

export function normalizeManagedByCustomerId(
  managedByCustomerId: string,
  customerType: CustomerType,
): string {
  const normalizedManagedByCustomerId = managedByCustomerId.trim();

  if (normalizedManagedByCustomerId.length > 200) {
    throw new CustomerValidationError('Managed by customer id must be 200 characters or less.');
  }

  if (customerType !== 'housingCompany') {
    return '';
  }

  return normalizedManagedByCustomerId;
}

export function parseCustomerNumberMode(customerNumberMode: string): CustomerNumberMode {
  if (customerNumberMode === 'auto' || customerNumberMode === 'manual') {
    return customerNumberMode;
  }

  throw new CustomerValidationError('Customer number mode is invalid.');
}

export function parseCustomerStatus(status: string): CustomerStatus {
  if (status === 'active' || status === 'inactive') {
    return status;
  }

  throw new CustomerValidationError('Customer status is invalid.');
}

export function parseCustomerType(customerType: string): CustomerType {
  if (
    customerType === 'company' ||
    customerType === 'housingCompany' ||
    customerType === 'other' ||
    customerType === 'privatePerson' ||
    customerType === 'propertyManager'
  ) {
    return customerType;
  }

  throw new CustomerValidationError('Customer type is invalid.');
}
