import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError } from '../index.js';

describe('diagnostics API client', () => {
  it('lists the safe projection with a bounded optional limit', async () => {
    const requests: string[] = [];
    const client = createEkyApiClient({
      baseUrl: 'http://127.0.0.1:3000/',
      fetch: async (input) => {
        requests.push(input.toString());
        return jsonResponse({
          diagnosticEvents: [
            {
              category: 'smtp',
              component: 'backend',
              errorCode: 'SMTP_TLS_FAILED',
              eventName: 'smtp.tlsFailed',
              id: 'backend:event-1',
              level: 'error',
              occurredAt: '2026-07-27T12:00:00.000Z',
              outcome: 'failure',
            },
          ],
        });
      },
    });

    await expect(
      client.listDiagnosticEvents({ limit: 20 }),
    ).resolves.toHaveLength(1);
    expect(requests).toEqual([
      'http://127.0.0.1:3000/diagnostics/events?limit=20',
    ]);
  });

  it('rejects excessive limits before a request', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse({}),
    });

    await expect(
      client.listDiagnosticEvents({ limit: 201 }),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects raw metadata and unknown event names', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          diagnosticEvents: [
            {
              category: 'smtp',
              component: 'backend',
              errorCode: null,
              eventName: 'smtp.rawProviderResponse',
              id: 'backend:event-1',
              level: 'error',
              occurredAt: '2026-07-27T12:00:00.000Z',
              outcome: 'failure',
              rawMetadata: { email: 'must-not-be-exposed@example.test' },
            },
          ],
        }),
    });

    await expect(client.listDiagnosticEvents()).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

