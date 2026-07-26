import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import {
  DiagnosticEventValidationError,
  type ListDiagnosticEventsInput,
} from '../application/listDiagnosticEvents.js';
import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';

interface DiagnosticRouteDependencies {
  listDiagnosticEvents(
    input: ListDiagnosticEventsInput,
  ): Promise<DiagnosticEventItem[]>;
}

export function createDiagnosticRoutes(
  dependencies: DiagnosticRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/diagnostics/events', async (context) => {
    const query = context.req.query();
    if (Object.keys(query).some((key) => key !== 'limit')) {
      return context.json({ error: 'Unsupported diagnostics query.' }, 400);
    }

    const rawLimit = query.limit;
    const limit =
      rawLimit === undefined || rawLimit === ''
        ? undefined
        : parseStrictPositiveInteger(rawLimit);
    if (rawLimit !== undefined && limit === undefined) {
      return context.json({ error: 'Diagnostics limit is invalid.' }, 400);
    }

    try {
      const diagnosticEvents = await dependencies.listDiagnosticEvents({
        actorContext: context.get('actorContext'),
        ...(limit === undefined ? {} : { limit }),
      });
      return context.json({ diagnosticEvents });
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
  if (error instanceof DiagnosticEventValidationError) {
    return context.json({ error: error.message }, 400);
  }
  throw error;
}

