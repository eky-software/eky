import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import {
  ActivityValidationError,
  type ListActivityInput,
} from '../application/listActivity.js';
import type { ActivityItem } from '../domain/activityItem.js';

interface ActivityRouteDependencies {
  listActivity(input: ListActivityInput): Promise<ActivityItem[]>;
}

export function createActivityRoutes(
  dependencies: ActivityRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/activity', async (context) => {
    const query = context.req.query();
    if (Object.keys(query).some((key) => key !== 'limit')) {
      return context.json({ error: 'Unsupported activity query.' }, 400);
    }

    const rawLimit = query.limit;
    const limit =
      rawLimit === undefined || rawLimit === ''
        ? undefined
        : parseStrictPositiveInteger(rawLimit);
    if (rawLimit !== undefined && limit === undefined) {
      return context.json({ error: 'Activity limit is invalid.' }, 400);
    }

    try {
      const activityItems = await dependencies.listActivity({
        actorContext: context.get('actorContext'),
        ...(limit === undefined ? {} : { limit }),
      });
      return context.json({ activityItems });
    } catch (error) {
      return handleKnownError(context, error);
    }
  });

  return routes;
}

function parseStrictPositiveInteger(value: string): number | undefined {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

function handleKnownError(
  context: Context<BackendEnvironment>,
  error: unknown,
) {
  if (error instanceof AuthorizationError) {
    return context.json({ error: 'Forbidden.' }, 403);
  }
  if (error instanceof ActivityValidationError) {
    return context.json({ error: error.message }, 400);
  }
  throw error;
}
