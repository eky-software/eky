import type {
  CreateCustomerRequest,
  Customer,
  CustomerStatus,
  CustomerType,
  UpdateCustomerRequest,
} from '@eky/api-client';

import { centsToEuroInput, euroInputToCents } from '../money/hourlyRateInput.js';

export interface CustomerFormModel {
  businessId: string;
  city: string;
  comment: string;
  customerNumber?: string;
  customerNumberMode: 'auto' | 'manual';
  customerType: CustomerType;
  email: string;
  hourlyRateOverrideEuro: string;
  managedByCustomerId: string;
  name: string;
  phone: string;
  postalCode: string;
  status: CustomerStatus;
  streetAddress: string;
}

export const initialCustomerForm: CustomerFormModel = {
  businessId: '',
  city: '',
  comment: '',
  customerNumber: '',
  customerNumberMode: 'auto',
  customerType: 'company',
  email: '',
  hourlyRateOverrideEuro: '',
  managedByCustomerId: '',
  name: '',
  phone: '',
  postalCode: '',
  status: 'active',
  streetAddress: '',
};

export function toCustomerForm(customer: Customer): CustomerFormModel {
  return {
    businessId: customer.businessId,
    city: customer.city,
    comment: customer.comment,
    customerNumber: customer.customerNumber,
    customerNumberMode: 'manual',
    customerType: customer.customerType,
    email: customer.email,
    hourlyRateOverrideEuro: centsToEuroInput(customer.hourlyRateOverrideCents),
    managedByCustomerId: customer.managedByCustomerId,
    name: customer.name,
    phone: customer.phone,
    postalCode: customer.postalCode,
    status: customer.status,
    streetAddress: customer.streetAddress,
  };
}

export function toCreateCustomerRequest(form: CustomerFormModel): CreateCustomerRequest {
  const request: CreateCustomerRequest = {
    businessId: form.businessId,
    city: form.city,
    comment: form.comment,
    customerNumberMode: form.customerNumberMode,
    customerType: form.customerType,
    email: form.email,
    hourlyRateOverrideCents: euroInputToCents(form.hourlyRateOverrideEuro),
    managedByCustomerId: form.managedByCustomerId,
    name: form.name,
    phone: form.phone,
    postalCode: form.postalCode,
    status: form.status,
    streetAddress: form.streetAddress,
  };

  if (form.customerNumber !== undefined) {
    request.customerNumber = form.customerNumber;
  }

  return request;
}

export function toUpdateCustomerRequest(form: CustomerFormModel): UpdateCustomerRequest {
  return {
    businessId: form.businessId,
    city: form.city,
    comment: form.comment,
    customerNumber: form.customerNumber ?? '',
    customerType: form.customerType,
    email: form.email,
    hourlyRateOverrideCents: euroInputToCents(form.hourlyRateOverrideEuro),
    managedByCustomerId: form.managedByCustomerId,
    name: form.name,
    phone: form.phone,
    postalCode: form.postalCode,
    status: form.status,
    streetAddress: form.streetAddress,
  };
}
