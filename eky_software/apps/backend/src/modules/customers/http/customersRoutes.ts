import { Hono } from 'hono';

import { CustomerValidationError } from '../domain/customerRules.js';
import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { UpdateCustomerInput } from '../application/updateCustomer.js';
import type { Customer } from '../domain/customer.js';

// Temporary local development company id.
// This is not an authentication, tenant, or permission model.
const devCompanyId = 'dev-company';

interface CustomersRouteDependencies {
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  listCustomers(input: ListCustomersInput): Promise<Customer[]>;
  updateCustomer(input: UpdateCustomerInput): Promise<Customer>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOptionalStringField(body: Record<string, unknown>, fieldName: string): string {
  const value = body[fieldName];

  if (value === undefined || value === null) {
    return '';
  }

  return typeof value === 'string' ? value : '';
}

function getStringField(body: Record<string, unknown>, fieldName: string): string | undefined {
  const value = body[fieldName];

  return typeof value === 'string' ? value : undefined;
}

function getCustomerNumberMode(body: Record<string, unknown>): string {
  const customerNumberMode = getOptionalStringField(body, 'customerNumberMode');
  const customerNumber = getStringField(body, 'customerNumber');

  if (customerNumberMode.length > 0) {
    return customerNumberMode;
  }

  return customerNumber === undefined ? 'auto' : 'manual';
}

export function createCustomersRoutes(dependencies: CustomersRouteDependencies): Hono {
  const routes = new Hono();

  routes.post('/customers', async (context) => {
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
        companyId: devCompanyId,
        customerNumberMode,
        customerType: getOptionalStringField(body, 'customerType') || 'company',
        email: getOptionalStringField(body, 'email'),
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
    const customers = await dependencies.listCustomers({
      companyId: devCompanyId,
    });

    return context.json({ customers });
  });

  routes.put('/customers/:id', async (context) => {
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
        companyId: devCompanyId,
        customerNumber,
        customerType: getOptionalStringField(body, 'customerType') || 'company',
        email: getOptionalStringField(body, 'email'),
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
