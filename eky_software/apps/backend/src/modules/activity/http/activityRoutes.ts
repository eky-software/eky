import { AuthorizationError } from '@eky/permissions';
import { Hono, type Context } from 'hono';

import { parseOptionalBoundedPositiveIntegerQuery } from '../../../http/parseOptionalBoundedPositiveIntegerQuery.js';
import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import {
  ActivityValidationError,
  activityPageSizes,
  maximumActivityPage,
  type ListActivityInput,
} from '../application/listActivity.js';
import type {
  ActivityCategory,
  ActivityOutcomeFilter,
  ActivityPage,
} from '../domain/activityItem.js';

interface ActivityRouteDependencies {
  listActivity(input: ListActivityInput): Promise<ActivityPage>;
}

const supportedQueryKeys = new Set([
  'category',
  'month',
  'outcome',
  'page',
  'pageSize',
]);

export function createActivityRoutes(
  dependencies: ActivityRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();

  routes.get('/activity', async (context) => {
    const query = context.req.query();
    if (Object.keys(query).some((key) => !supportedQueryKeys.has(key))) {
      return context.json({ error: 'Unsupported activity query.' }, 400);
    }

    const parsed = parseQuery(query);
    if (parsed === null) {
      return context.json({ error: 'Activity query is invalid.' }, 400);
    }

    try {
      const page = await dependencies.listActivity({
        actorContext: context.get('actorContext'),
        ...parsed,
      });
      return context.json(page);
    } catch (error) {
      return handleKnownError(context, error);
    }
  });

  return routes;
}

interface ParsedActivityQuery {
  category?: ActivityCategory;
  month?: string;
  outcome?: ActivityOutcomeFilter;
  page?: number;
  pageSize?: number;
}

function parseQuery(
  query: Record<string, string>,
): ParsedActivityQuery | null {
  const category = parseOptionalCategory(query.category);
  const month = parseOptionalMonth(query.month);
  const outcome = parseOptionalOutcome(query.outcome);
  const page = parseOptionalBoundedPositiveIntegerQuery(
    query.page,
    1,
    maximumActivityPage,
  );
  const pageSize = parseOptionalPageSize(query.pageSize);

  if (
    category === null ||
    month === null ||
    outcome === null ||
    page === null ||
    pageSize === null
  ) {
    return null;
  }

  return {
    ...(category === undefined ? {} : { category }),
    ...(month === undefined ? {} : { month }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
  };
}

function parseOptionalCategory(
  value: string | undefined,
): ActivityCategory | null | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return value === 'all' ||
    value === 'companySettings' ||
    value === 'customers' ||
    value === 'invoicing'
    ? value
    : null;
}

function parseOptionalOutcome(
  value: string | undefined,
): ActivityOutcomeFilter | null | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return value === 'all' ||
    value === 'blocked' ||
    value === 'failure' ||
    value === 'success' ||
    value === 'unknown'
    ? value
    : null;
}

function parseOptionalMonth(value: string | undefined): string | null | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

function parseOptionalPageSize(
  value: string | undefined,
): number | null | undefined {
  const parsed = parseOptionalBoundedPositiveIntegerQuery(value, 1, 100);
  if (parsed === undefined || parsed === null) {
    return parsed;
  }
  return activityPageSizes.includes(
    parsed as (typeof activityPageSizes)[number],
  )
    ? parsed
    : null;
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
