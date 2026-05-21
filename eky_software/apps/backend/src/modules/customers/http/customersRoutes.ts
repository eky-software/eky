import { Hono } from 'hono';

import { CustomerValidationError } from '../domain/customerRules.js';
import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { Customer } from '../domain/customer.js';

const devCompanyId = 'dev-company';

interface CustomersRouteDependencies {
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  listCustomers(input: ListCustomersInput): Promise<Customer[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    try {
      const customer = await dependencies.createCustomer({
        companyId: devCompanyId,
        name: body.name,
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
