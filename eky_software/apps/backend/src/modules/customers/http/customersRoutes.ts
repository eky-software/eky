import { Hono } from 'hono';

import {
  getOptionalStringField,
  getStringField,
  isRecord,
} from '../../../http/requestBody.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { CustomerValidationError } from '../domain/customerRules.js';
import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { UpdateCustomerInput } from '../application/updateCustomer.js';
import type { Customer } from '../domain/customer.js';

interface CustomersRouteDependencies {
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  listCustomers(input: ListCustomersInput): Promise<Customer[]>;
  updateCustomer(input: UpdateCustomerInput): Promise<Customer>;
}

function getCustomerNumberMode(body: Record<string, unknown>): string {
  const customerNumberMode = getOptionalStringField(body, 'customerNumberMode');
  const customerNumber = getStringField(body, 'customerNumber');

  if (customerNumberMode.length > 0) {
    return customerNumberMode;
  }

  return customerNumber === undefined ? 'auto' : 'manual';
}

export function createCustomersRoutes(
  dependencies: CustomersRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.post('/customers', async (context) => {
    const actorContext = context.get('actorContext');
    let body: unknown;

    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON body.' }, 400);
    }

    if (!isRecord(body) || typeof body.name !== 'string') {
      return context.json({ error: 'Customer name is required.' }, 400);
    }

    const customerNumberMode = getCustomerNumberMode(body);
    const customerNumber = getStringField(body, 'customerNumber');

    try {
      const createCustomerInput: CreateCustomerInput = {
        businessId: getOptionalStringField(body, 'businessId'),
        city: getOptionalStringField(body, 'city'),
        comment: getOptionalStringField(body, 'comment'),
        companyId: actorContext.companyId,
        customerNumberMode,
        customerType: getOptionalStringField(body, 'customerType') || 'company',
        email: getOptionalStringField(body, 'email'),
        hourlyRateOverrideCents: body.hourlyRateOverrideCents,
        managedByCustomerId: getOptionalStringField(body, 'managedByCustomerId'),
        name: body.name,
        phone: getOptionalStringField(body, 'phone'),
        postalCode: getOptionalStringField(body, 'postalCode'),
        status: getOptionalStringField(body, 'status') || 'active',
        streetAddress: getOptionalStringField(body, 'streetAddress'),
      };

      if (customerNumber !== undefined) {
        createCustomerInput.customerNumber = customerNumber;
      }

      const customer = await dependencies.createCustomer(createCustomerInput);

      return context.json({ customer }, 201);
    } catch (error) {
      if (error instanceof CustomerValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.get('/customers', async (context) => {
    const actorContext = context.get('actorContext');
    const customers = await dependencies.listCustomers({
      companyId: actorContext.companyId,
    });

    return context.json({ customers });
  });

  routes.put('/customers/:id', async (context) => {
    const actorContext = context.get('actorContext');
    let body: unknown;

    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON body.' }, 400);
    }

    if (!isRecord(body) || typeof body.name !== 'string') {
      return context.json({ error: 'Customer name is required.' }, 400);
    }

    const customerNumber = getStringField(body, 'customerNumber');

    if (customerNumber === undefined) {
      return context.json({ error: 'Customer number is required.' }, 400);
    }

    try {
      const customer = await dependencies.updateCustomer({
        businessId: getOptionalStringField(body, 'businessId'),
        city: getOptionalStringField(body, 'city'),
        comment: getOptionalStringField(body, 'comment'),
        companyId: actorContext.companyId,
        customerNumber,
        customerType: getOptionalStringField(body, 'customerType') || 'company',
        email: getOptionalStringField(body, 'email'),
        hourlyRateOverrideCents: body.hourlyRateOverrideCents,
        id: context.req.param('id'),
        managedByCustomerId: getOptionalStringField(body, 'managedByCustomerId'),
        name: body.name,
        phone: getOptionalStringField(body, 'phone'),
        postalCode: getOptionalStringField(body, 'postalCode'),
        status: getOptionalStringField(body, 'status') || 'active',
        streetAddress: getOptionalStringField(body, 'streetAddress'),
      });

      return context.json({ customer });
    } catch (error) {
      if (error instanceof CustomerValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  return routes;
}
