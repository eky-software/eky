import type { CreateCustomerRequest, Customer, UpdateCustomerRequest } from '@eky/api-client';

export const initialCustomerForm: CreateCustomerRequest = {
  businessId: '',
  city: '',
  comment: '',
  customerNumber: '',
  customerNumberMode: 'auto',
  customerType: 'company',
  email: '',
  managedByCustomerId: '',
  name: '',
  phone: '',
  postalCode: '',
  status: 'active',
  streetAddress: '',
};

export function toCustomerForm(customer: Customer): CreateCustomerRequest {
  return {
    businessId: customer.businessId,
    city: customer.city,
    comment: customer.comment,
    customerNumber: customer.customerNumber,
    customerNumberMode: 'manual',
    customerType: customer.customerType,
    email: customer.email,
    managedByCustomerId: customer.managedByCustomerId,
    name: customer.name,
    phone: customer.phone,
    postalCode: customer.postalCode,
    status: customer.status,
    streetAddress: customer.streetAddress,
  };
}

export function toUpdateCustomerRequest(form: CreateCustomerRequest): UpdateCustomerRequest {
  return {
    businessId: form.businessId,
    city: form.city,
    comment: form.comment,
    customerNumber: form.customerNumber ?? '',
    customerType: form.customerType,
    email: form.email,
    managedByCustomerId: form.managedByCustomerId,
    name: form.name,
    phone: form.phone,
    postalCode: form.postalCode,
    status: form.status,
    streetAddress: form.streetAddress,
  };
}
