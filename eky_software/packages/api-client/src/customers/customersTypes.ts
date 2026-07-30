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

export type CustomerActivityAction =
  | 'customer.activated'
  | 'customer.created'
  | 'customer.deactivated'
  | 'customer.updated';

export type CustomerActivityChangeCategory =
  | 'billing'
  | 'contact'
  | 'identity'
  | 'pricing'
  | 'status';

export interface CustomerActivityEntry {
  action: CustomerActivityAction;
  changeCategories: readonly CustomerActivityChangeCategory[];
  id: string;
  occurredAt: string;
}

export interface CustomerActivityPage {
  activityEntries: CustomerActivityEntry[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  pageSize: 20 | 50;
}

export interface CustomerActivityQuery {
  page?: number;
  pageSize?: 20 | 50;
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
  getCustomer(id: string): Promise<Customer>;
  listCustomerActivity(
    id: string,
    query?: CustomerActivityQuery,
  ): Promise<CustomerActivityPage>;
  listCustomers(): Promise<Customer[]>;
  updateCustomer(id: string, input: UpdateCustomerRequest): Promise<Customer>;
}
