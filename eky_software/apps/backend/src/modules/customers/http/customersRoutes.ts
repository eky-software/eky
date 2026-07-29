import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import {
  getOptionalStringField,
  getStringField,
  isRecord,
} from '../../../http/requestBody.js';
import { readJsonRequestBody } from '../../../http/readJsonRequestBody.js';
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

const maximumCustomerBodySizeBytes = 16 * 1024;
const customerBodyLimit = bodyLimit({
  maxSize: maximumCustomerBodySizeBytes,
  onError: (context) =>
    context.json({ error: 'Customer body is too large.' }, 413),
});

const allowedCustomerBodyFields = new Set([
  'businessId',
  'city',
  'comment',
  'customerNumber',
  'customerNumberMode',
  'customerType',
  'email',
  'hourlyRateOverrideCents',
  'managedByCustomerId',
  'name',
  'phone',
  'postalCode',
  'status',
  'streetAddress',
]);

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

  routes.post('/customers', customerBodyLimit, async (context) => {
    const actorContext = context.get('actorContext');
    const bodyResult = await readJsonRequestBody(context.req, 'required');

    if (!bodyResult.ok) {
      return context.json(
        { error: bodyResult.message },
        bodyResult.status,
      );
    }
    const body = bodyResult.body;

    if (
      !isRecord(body) ||
      hasUnknownCustomerBodyFields(body) ||
      typeof body.name !== 'string'
    ) {
      return context.json({ error: 'Invalid customer body.' }, 400);
    }

    const customerNumberMode = getCustomerNumberMode(body);
    const customerNumber = getStringField(body, 'customerNumber');

    try {
      const createCustomerInput: CreateCustomerInput = {
        actorContext,
        businessId: getOptionalStringField(body, 'businessId'),
        city: getOptionalStringField(body, 'city'),
        comment: getOptionalStringField(body, 'comment'),
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

  routes.put('/customers/:id', customerBodyLimit, async (context) => {
    const actorContext = context.get('actorContext');
    const bodyResult = await readJsonRequestBody(context.req, 'required');

    if (!bodyResult.ok) {
      return context.json(
        { error: bodyResult.message },
        bodyResult.status,
      );
    }
    const body = bodyResult.body;

    if (
      !isRecord(body) ||
      hasUnknownCustomerBodyFields(body) ||
      typeof body.name !== 'string'
    ) {
      return context.json({ error: 'Invalid customer body.' }, 400);
    }

    const customerNumber = getStringField(body, 'customerNumber');

    if (customerNumber === undefined) {
      return context.json({ error: 'Customer number is required.' }, 400);
    }

    try {
      const customer = await dependencies.updateCustomer({
        actorContext,
        businessId: getOptionalStringField(body, 'businessId'),
        city: getOptionalStringField(body, 'city'),
        comment: getOptionalStringField(body, 'comment'),
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

function hasUnknownCustomerBodyFields(
  body: Record<string, unknown>,
): boolean {
  return Object.keys(body).some(
    (fieldName) => !allowedCustomerBodyFields.has(fieldName),
  );
}
