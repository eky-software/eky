import { Hono } from 'hono';

import { CustomerValidationError } from '../domain/customerRules.js';
import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { Customer } from '../domain/customer.js';

// Temporary local development company id.
// This is not an authentication, tenant, or permission model.
const devCompanyId = 'dev-company';

interface CustomersRouteDependencies {
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  listCustomers(input: ListCustomersInput): Promise<Customer[]>;
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

    const customerNumber = getStringField(body, 'customerNumber');

    if (customerNumber === undefined) {
      return context.json({ error: 'Customer number is required.' }, 400);
    }

    try {
      const customer = await dependencies.createCustomer({
        businessId: getOptionalStringField(body, 'businessId'),
        city: getOptionalStringField(body, 'city'),
        comment: getOptionalStringField(body, 'comment'),
        companyId: devCompanyId,
        customerNumber,
        customerType: getOptionalStringField(body, 'customerType') || 'company',
        email: getOptionalStringField(body, 'email'),
        name: body.name,
        phone: getOptionalStringField(body, 'phone'),
        postalCode: getOptionalStringField(body, 'postalCode'),
        status: getOptionalStringField(body, 'status') || 'active',
        streetAddress: getOptionalStringField(body, 'streetAddress'),
      });

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

  return routes;
}
