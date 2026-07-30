import { AuthorizationError } from '@eky/permissions';
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
import type { GetCustomerInput } from '../application/getCustomer.js';
import type { ListCustomerHistoryInput } from '../application/listCustomerHistory.js';
import {
  customerHistoryPageSizes,
  maximumCustomerHistoryPage,
} from '../application/listCustomerHistory.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { UpdateCustomerInput } from '../application/updateCustomer.js';
import type { Customer } from '../domain/customer.js';
import type { CustomerHistoryPage } from '../domain/customerHistory.js';
import {
  CustomerNotFoundError,
  CustomerReadValidationError,
} from '../application/customerReadErrors.js';

interface CustomersRouteDependencies {
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  getCustomer(input: GetCustomerInput): Promise<Customer>;
  listCustomerHistory(
    input: ListCustomerHistoryInput,
  ): Promise<CustomerHistoryPage>;
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
const supportedCustomerHistoryQueryKeys = new Set(['page', 'pageSize']);

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

  routes.get('/customers/:id/activity', async (context) => {
    const query = context.req.query();

    if (
      Object.keys(query).some(
        (key) => !supportedCustomerHistoryQueryKeys.has(key),
      )
    ) {
      return context.json({ error: 'Unsupported customer activity query.' }, 400);
    }

    const page = parseOptionalInteger(
      query.page,
      1,
      maximumCustomerHistoryPage,
    );
    const pageSize = parseOptionalCustomerHistoryPageSize(query.pageSize);

    if (page === null || pageSize === null) {
      return context.json({ error: 'Customer activity query is invalid.' }, 400);
    }

    try {
      const customerActivityPage =
        await dependencies.listCustomerHistory({
          actorContext: context.get('actorContext'),
          customerId: context.req.param('id'),
          ...(page === undefined ? {} : { page }),
          ...(pageSize === undefined ? {} : { pageSize }),
        });

      return context.json({ customerActivityPage });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return context.json({ error: 'Forbidden.' }, 403);
      }
      if (error instanceof CustomerNotFoundError) {
        return context.json({ error: error.message }, 404);
      }
      if (error instanceof CustomerReadValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
  });

  routes.get('/customers/:id', async (context) => {
    if (Object.keys(context.req.query()).length > 0) {
      return context.json({ error: 'Unsupported customer query.' }, 400);
    }

    try {
      const customer = await dependencies.getCustomer({
        actorContext: context.get('actorContext'),
        customerId: context.req.param('id'),
      });

      return context.json({ customer });
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        return context.json({ error: error.message }, 404);
      }
      if (error instanceof CustomerReadValidationError) {
        return context.json({ error: error.message }, 400);
      }

      throw error;
    }
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

function parseOptionalInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!/^[1-9][0-9]{0,2}$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return parsed >= minimum && parsed <= maximum ? parsed : null;
}

function parseOptionalCustomerHistoryPageSize(
  value: string | undefined,
): number | null | undefined {
  const parsed = parseOptionalInteger(value, 1, 50);

  if (parsed === undefined || parsed === null) {
    return parsed;
  }

  return customerHistoryPageSizes.includes(
    parsed as (typeof customerHistoryPageSizes)[number],
  )
    ? parsed
    : null;
}

function hasUnknownCustomerBodyFields(
  body: Record<string, unknown>,
): boolean {
  return Object.keys(body).some(
    (fieldName) => !allowedCustomerBodyFields.has(fieldName),
  );
}
