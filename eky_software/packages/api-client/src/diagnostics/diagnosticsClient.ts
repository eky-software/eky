import { EkyApiError, isRecord, requestJson } from '../http.js';
import { isDiagnosticCursor } from './diagnosticsCursor.js';
import {
  readDiagnosticSummaryResponse,
  readDiagnosticsResponse,
} from './diagnosticsResponse.js';
import type {
  DiagnosticEventListQuery,
  DiagnosticsApi,
} from './diagnosticsTypes.js';
import { maximumDiagnosticEventLimit } from './diagnosticsTypes.js';

export function createDiagnosticsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): DiagnosticsApi {
  return {
    async getDiagnosticSummary() {
      return readDiagnosticSummaryResponse(
        await requestJson(
          fetchImplementation,
          baseUrl,
          '/diagnostics/summary',
        ),
      );
    },
    async listDiagnosticEvents(query: DiagnosticEventListQuery = {}, signal?: AbortSignal) {
      return readDiagnosticsResponse(
        await requestJson(
          fetchImplementation,
          baseUrl,
          createDiagnosticsPath(query),
          signal === undefined ? undefined : { signal },
        ),
      );
    },
  };
}

function createDiagnosticsPath(query: DiagnosticEventListQuery): string {
  if (
    !isRecord(query) ||
    Object.keys(query).some((key) => key !== 'limit' && key !== 'cursor') ||
    (query.limit !== undefined && query.cursor !== undefined)
  ) {
    throw new EkyApiError('Invalid diagnostics query.');
  }
  if (query.cursor !== undefined) {
    if (!isDiagnosticCursor(query.cursor)) {
      throw new EkyApiError('Invalid diagnostics query.');
    }
    return `/diagnostics/events?cursor=${query.cursor}`;
  }
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
