export type CustomerStatus = 'active' | 'inactive';

export type CustomerType =
  | 'company'
  | 'housingCompany'
  | 'other'
  | 'privatePerson'
  | 'propertyManager';

export interface Customer {
  id: string;
  companyId: string;
  customerNumber: string;
  name: string;
  customerType: CustomerType;
  businessId: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  comment: string;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerDomainInput {
  businessId: string;
  city: string;
  comment: string;
  customerNumber: string;
  customerType: CustomerType;
  email: string;
  id: string;
  companyId: string;
  name: string;
  now: string;
  phone: string;
  postalCode: string;
  status: CustomerStatus;
  streetAddress: string;
}

export function createCustomerRecord(input: CreateCustomerDomainInput): Customer {
  return {
    id: input.id,
    companyId: input.companyId,
    customerNumber: input.customerNumber,
    name: input.name,
    customerType: input.customerType,
    businessId: input.businessId,
    streetAddress: input.streetAddress,
    postalCode: input.postalCode,
    city: input.city,
    email: input.email,
    phone: input.phone,
    comment: input.comment,
    status: input.status,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
