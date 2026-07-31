import type { ActorContext } from '@eky/auth';

import type { Customer } from '../domain/customer.js';
import type { CustomerDetailReader } from '../ports/customerDetailReader.js';
import {
  CustomerNotFoundError,
  requireCustomerResourceId,
} from './customerReadErrors.js';

export interface GetCustomerInput {
  actorContext: ActorContext;
  customerId: string;
}

export async function getCustomer(
  input: GetCustomerInput,
  customerDetailReader: CustomerDetailReader,
): Promise<Customer> {
  const customerId = requireCustomerResourceId(input.customerId);
  const customer = await customerDetailReader.findById(
    input.actorContext.companyId,
    customerId,
  );

  if (customer === undefined) {
    throw new CustomerNotFoundError();
  }

  return customer;
}
