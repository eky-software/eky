import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError } from '../index.js';

describe('activity API client', () => {
  it('lists the safe activity projection with an optional limit', async () => {
    const requests: string[] = [];
    const client = createEkyApiClient({
      baseUrl: 'http://127.0.0.1:3000/',
      fetch: async (input) => {
        requests.push(input.toString());
        return jsonResponse({
          activityItems: [
            {
              id: 'customers:event-1',
              module: 'customers',
              occurredAt: '2026-07-27T10:00:00.000Z',
              reference: { kind: 'customerNumber', value: '1001' },
              type: 'customer.updated',
            },
          ],
        });
      },
    });

    await expect(client.listActivity({ limit: 20 })).resolves.toHaveLength(1);
    expect(requests).toEqual(['http://127.0.0.1:3000/activity?limit=20']);
  });

  it('rejects invalid limits before making a request', async () => {
    const fetchImplementation = async () => jsonResponse({});
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: fetchImplementation,
    });

    await expect(client.listActivity({ limit: 101 })).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });

  it('rejects unknown fields that could expose raw audit metadata', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          activityItems: [
            {
              id: 'customers:event-1',
              module: 'customers',
              occurredAt: '2026-07-27T10:00:00.000Z',
              rawMetadata: { customerName: 'Must not be exposed' },
              reference: { kind: 'customerNumber', value: '1001' },
              type: 'customer.updated',
            },
          ],
        }),
    });

    await expect(client.listActivity()).rejects.toBeInstanceOf(EkyApiError);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
