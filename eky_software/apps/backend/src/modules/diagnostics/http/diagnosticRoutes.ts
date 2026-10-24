import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import {
  DiagnosticEventValidationError,
  maximumDiagnosticEventLimit,
  type ListDiagnosticEventsInput,
} from '../application/listDiagnosticEvents.js';
import type { PrepareSupportBundleDiagnosticDataInput } from '../application/prepareSupportBundleDiagnosticData.js';
import type {
  GetRuntimeDiagnosticSummaryInput,
} from '../application/getRuntimeDiagnosticSummary.js';
import type { DiagnosticEventPage } from '../domain/diagnosticEventPage.js';
import { DiagnosticBrowseError, isDiagnosticBrowseCursor } from '../domain/diagnosticBrowsePolicy.js';
import type { RuntimeDiagnosticSummary } from '../domain/runtimeDiagnosticSummary.js';
import type { SupportBundleDiagnosticData } from '../domain/supportBundleDiagnosticData.js';

interface DiagnosticRouteDependencies {
  getRuntimeDiagnosticSummary(
    input: GetRuntimeDiagnosticSummaryInput,
  ): Promise<RuntimeDiagnosticSummary>;
  listDiagnosticEvents(
    input: ListDiagnosticEventsInput,
  ): Promise<DiagnosticEventPage>;
  prepareSupportBundleDiagnosticData(
    input: PrepareSupportBundleDiagnosticDataInput,
  ): Promise<SupportBundleDiagnosticData>;
}

export function createDiagnosticRoutes(
  dependencies: DiagnosticRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/diagnostics/summary', async (context) => {
    if (Object.keys(context.req.query()).length > 0) {
      return context.json({ error: 'Unsupported diagnostics query.' }, 400);
    }

    try {
      return context.json(
        await dependencies.getRuntimeDiagnosticSummary({
          actorContext: context.get('actorContext'),
        }),
      );
    } catch (error) {
      return handleKnownError(context, error);
    }
  });

  routes.get('/diagnostics/events', async (context) => {
    context.header('Cache-Control', 'no-store');
    const query = context.req.queries();
    if (Object.keys(query).some(key => (key !== 'limit' && key !== 'cursor') || query[key]?.length !== 1)
      || (query.limit !== undefined && query.cursor !== undefined)) {
      return context.json({ error: 'Unsupported diagnostics query.' }, 400);
    }

    const rawCursor = query.cursor?.[0];
    if (rawCursor !== undefined && !isDiagnosticBrowseCursor(rawCursor)) {
      return context.json({ error: 'Diagnostics cursor is invalid.' }, 400);
    }
    const rawLimit = query.limit?.[0];
    const limit =
      rawLimit === undefined || rawLimit === ''
        ? undefined
        : parseStrictPositiveInteger(rawLimit);
    if (rawLimit !== undefined && limit === undefined) {
      return context.json({ error: 'Diagnostics limit is invalid.' }, 400);
    }

    try {
      const result = await dependencies.listDiagnosticEvents({
        actorContext: context.get('actorContext'),
        ...(limit === undefined ? {} : { limit }),
        ...(rawCursor === undefined ? {} : { cursor: rawCursor }),
      });
      return context.json(result);
    } catch (error) {
      return handleKnownError(context, error);
    }
  });

  routes.get('/diagnostics/support-bundle-data', async (context) => {
    if (Object.keys(context.req.query()).length > 0) {
      return context.json(
        { error: 'Unsupported support bundle query.' },
        400,
      );
    }

    try {
      return context.json(
        await dependencies.prepareSupportBundleDiagnosticData({
          actorContext: context.get('actorContext'),
        }),
      );
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
  const parsed = Number(value);
  return String(parsed) === value && parsed <= maximumDiagnosticEventLimit ? parsed : undefined;
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
  if (error instanceof DiagnosticBrowseError) {
    return context.json({ error: error.message, code: error.code }, error.code === 'diagnostic_browse_busy' ? 429 : 409);
  }
  throw error;
}
