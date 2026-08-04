import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { parseOptionalBoundedPositiveIntegerQuery } from '../../../http/parseOptionalBoundedPositiveIntegerQuery.js';
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
import {
  parseCreateCustomerRequest,
  parseUpdateCustomerRequest,
} from './customerRequest.js';

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

const supportedCustomerHistoryQueryKeys = new Set(['page', 'pageSize']);

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
    const parsedBody = parseCreateCustomerRequest(bodyResult.body);

    if (parsedBody === null) {
      return context.json({ error: 'Invalid customer body.' }, 400);
    }

    try {
      const createCustomerInput: CreateCustomerInput = {
        actorContext,
        ...parsedBody,
      };

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

    const page = parseOptionalBoundedPositiveIntegerQuery(
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
    const parsedBodyResult = parseUpdateCustomerRequest(bodyResult.body);

    if (!parsedBodyResult.ok) {
      return context.json(
        {
          error:
            parsedBodyResult.reason === 'customerNumberRequired'
              ? 'Customer number is required.'
              : 'Invalid customer body.',
        },
        400,
      );
    }

    try {
      const customer = await dependencies.updateCustomer({
        actorContext,
        id: context.req.param('id'),
        ...parsedBodyResult.input,
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

function parseOptionalCustomerHistoryPageSize(
  value: string | undefined,
): number | null | undefined {
  const parsed = parseOptionalBoundedPositiveIntegerQuery(value, 1, 50);

  if (parsed === undefined || parsed === null) {
    return parsed;
  }

  return customerHistoryPageSizes.includes(
    parsed as (typeof customerHistoryPageSizes)[number],
  )
    ? parsed
    : null;
}
