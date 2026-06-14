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
  managedByCustomerId: string;
  phone: string;
  comment: string;
  hourlyRateOverrideCents: number | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerRequest {
  businessId: string;
  city: string;
  comment: string;
  customerNumber?: string;
  customerNumberMode: 'auto' | 'manual';
  customerType: CustomerType;
  email: string;
  hourlyRateOverrideCents: number | null;
  managedByCustomerId: string;
  name: string;
  phone: string;
  postalCode: string;
  status: CustomerStatus;
  streetAddress: string;
}

export interface UpdateCustomerRequest {
  businessId: string;
  city: string;
  comment: string;
  customerNumber: string;
  customerType: CustomerType;
  email: string;
  hourlyRateOverrideCents: number | null;
  managedByCustomerId: string;
  name: string;
  phone: string;
  postalCode: string;
  status: CustomerStatus;
  streetAddress: string;
}

export interface CustomersApi {
  createCustomer(input: CreateCustomerRequest): Promise<Customer>;
  listCustomers(): Promise<Customer[]>;
  updateCustomer(id: string, input: UpdateCustomerRequest): Promise<Customer>;
}
