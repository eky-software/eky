import { expect, type APIRequestContext } from '@playwright/test';

import { createDiagnosticsApi } from '../../../../packages/api-client/src/diagnostics/diagnosticsClient.js';
import type {
  DiagnosticEventListQuery,
  DiagnosticEventReadResult,
} from '../../../../packages/api-client/src/diagnostics/diagnosticsTypes.js';

export const maximumDiagnosticPageRequests = 4096;

export async function readDiagnosticPage(
  context: APIRequestContext,
  query: DiagnosticEventListQuery = {},
): Promise<Extract<DiagnosticEventReadResult, { state: 'ready' }>> {
  // The strict client builds/validates queries; the existing context owns transport and trust.
  const client = createDiagnosticsApi(async input => {
    const url = new URL(String(input));
    const response = await context.get(`${url.pathname}${url.search}`);
    expect(response.status()).toBe(200);
    return new Response(await response.text(), {
      status: response.status(), headers: { 'content-type': 'application/json' },
    });
  }, 'http://127.0.0.1');

  // Playwright retains ownership of the current test timeout, including all continuations.
  for (let request = 0; request < maximumDiagnosticPageRequests; request++) {
    const result = await client.listDiagnosticEvents(query);
    if (result.state === 'ready') return result;
    if (result.state !== 'scanning') {
      throw new Error(`Diagnostic page did not become ready: ${result.state}.`);
    }
    query = { cursor: result.cursor };
  }
  throw new Error('Diagnostic page exceeded the continuation request limit.');
}
