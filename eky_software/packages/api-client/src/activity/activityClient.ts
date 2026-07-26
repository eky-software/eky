import { EkyApiError, requestJson } from '../http.js';
import { readActivityResponse } from './activityResponse.js';
import type { ActivityApi, ActivityListQuery } from './activityTypes.js';

const maximumActivityLimit = 100;

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
  if (query.limit === undefined) {
    return '/activity';
  }
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > maximumActivityLimit
  ) {
    throw new EkyApiError('Invalid activity query.');
  }
  return `/activity?limit=${query.limit}`;
}
