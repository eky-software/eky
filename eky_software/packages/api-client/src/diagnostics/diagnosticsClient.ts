import { EkyApiError, requestJson } from '../http.js';
import { readDiagnosticsResponse } from './diagnosticsResponse.js';
import type {
  DiagnosticEventListQuery,
  DiagnosticsApi,
} from './diagnosticsTypes.js';

const maximumDiagnosticEventLimit = 200;

export function createDiagnosticsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): DiagnosticsApi {
  return {
    async listDiagnosticEvents(query: DiagnosticEventListQuery = {}) {
      return readDiagnosticsResponse(
        await requestJson(
          fetchImplementation,
          baseUrl,
          createDiagnosticsPath(query),
        ),
      );
    },
  };
}

function createDiagnosticsPath(query: DiagnosticEventListQuery): string {
  if (query.limit === undefined) {
    return '/diagnostics/events';
  }
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > maximumDiagnosticEventLimit
  ) {
    throw new EkyApiError('Invalid diagnostics query.');
  }
  return `/diagnostics/events?limit=${query.limit}`;
}

