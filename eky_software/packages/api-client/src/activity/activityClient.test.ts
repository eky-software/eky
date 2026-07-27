import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError } from '../index.js';

describe('activity API client', () => {
  it('lists a validated monthly activity page', async () => {
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
              outcome: 'success',
              reference: { kind: 'customerNumber', value: '1001' },
              type: 'customer.updated',
            },
          ],
          hasNextPage: false,
          hasPreviousPage: false,
          month: '2026-07',
          page: 1,
          pageSize: 20,
        });
      },
    });

    await expect(
      client.listActivity({
        category: 'customers',
        month: '2026-07',
        outcome: 'success',
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual(expect.objectContaining({ page: 1, pageSize: 20 }));
    expect(requests).toEqual([
      'http://127.0.0.1:3000/activity?month=2026-07&category=customers&outcome=success&page=1&pageSize=20',
    ]);
  });

  it('rejects invalid queries before making a request', async () => {
    const fetchImplementation = async () => jsonResponse({});
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: fetchImplementation,
    });

    await expect(
      client.listActivity({ month: '2026-13' }),
    ).rejects.toBeInstanceOf(EkyApiError);
    await expect(client.listActivity({ page: 101 })).rejects.toBeInstanceOf(
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
              outcome: 'success',
              rawMetadata: { customerName: 'Must not be exposed' },
              reference: { kind: 'customerNumber', value: '1001' },
              type: 'customer.updated',
            },
          ],
          hasNextPage: false,
          hasPreviousPage: false,
          month: '2026-07',
          page: 1,
          pageSize: 20,
        }),
    });

    await expect(client.listActivity()).rejects.toBeInstanceOf(EkyApiError);
  });

  it('accepts a safe invoice settings event without an entity reference', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          activityItems: [
            {
              id: 'invoicing:settings-event',
              module: 'invoicing',
              occurredAt: '2026-07-27T10:00:00.000Z',
              outcome: 'success',
              reference: null,
              type: 'invoiceNumberingSettings.updated',
            },
          ],
          hasNextPage: false,
          hasPreviousPage: false,
          month: '2026-07',
          page: 1,
          pageSize: 20,
        }),
    });

    await expect(client.listActivity()).resolves.toMatchObject({
      activityItems: [
        {
          reference: null,
          type: 'invoiceNumberingSettings.updated',
        },
      ],
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
