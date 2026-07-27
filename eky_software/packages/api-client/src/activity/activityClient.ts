import { EkyApiError, requestJson } from '../http.js';
import { readActivityResponse } from './activityResponse.js';
import type { ActivityApi, ActivityListQuery } from './activityTypes.js';

const maximumActivityPage = 100;

export function createActivityApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): ActivityApi {
  return {
    async listActivity(query: ActivityListQuery = {}) {
      return readActivityResponse(
        await requestJson(
          fetchImplementation,
          baseUrl,
          createActivityPath(query),
        ),
      );
    },
  };
}

function createActivityPath(query: ActivityListQuery): string {
  validateQuery(query);
  const search = new URLSearchParams();
  if (query.month !== undefined) {
    search.set('month', query.month);
  }
  if (query.category !== undefined) {
    search.set('category', query.category);
  }
  if (query.outcome !== undefined) {
    search.set('outcome', query.outcome);
  }
  if (query.page !== undefined) {
    search.set('page', String(query.page));
  }
  if (query.pageSize !== undefined) {
    search.set('pageSize', String(query.pageSize));
  }

  const queryString = search.toString();
  return queryString === '' ? '/activity' : `/activity?${queryString}`;
}

function validateQuery(query: ActivityListQuery): void {
  if (
    (query.month !== undefined &&
      !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(query.month)) ||
    (query.category !== undefined &&
      !['all', 'companySettings', 'customers', 'invoicing'].includes(
        query.category,
      )) ||
    (query.outcome !== undefined &&
      !['all', 'blocked', 'failure', 'success', 'unknown'].includes(
        query.outcome,
      )) ||
    (query.page !== undefined &&
      (!Number.isInteger(query.page) ||
        query.page < 1 ||
        query.page > maximumActivityPage)) ||
    (query.pageSize !== undefined &&
      ![20, 50, 100].includes(query.pageSize))
  ) {
    throw new EkyApiError('Invalid activity query.');
  }
}
