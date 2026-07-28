import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import {
  correlationIdHeaderName,
  createOperationalLoggingMiddleware,
  resolveCorrelationId,
} from './operationalLogging.js';
import type { BackendEnvironment } from './runtimeTrust.js';

const operationalIdentity = {
  appVersion: '0.0.0',
  buildRevision: '123456789abc',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
} as const;

describe('operational HTTP logging', () => {
  it('accepts only a strictly valid external correlation id', () => {
    const correlationId = '7f62df6c-9122-4ac7-8d0f-b8ed214ee97b';

    expect(resolveCorrelationId(correlationId)).toBe(correlationId);
    expect(resolveCorrelationId('not-a-correlation-id')).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it('returns the correlation id on a failed response without request data', async () => {
    const events: BackendOperationalEvent[] = [];
    const app = new Hono<BackendEnvironment>();
    app.use(
      '*',
      createOperationalLoggingMiddleware({
        operationalIdentity,
        operationalLogger: {
          write(event) {
            events.push(event);
          },
        },
      }),
    );
    app.get('/failure', (context) =>
      context.json({ error: 'Safe error.' }, 500),
    );

    const response = await app.request('/failure?private=value', {
      headers: {
        [correlationIdHeaderName]:
          '7f62df6c-9122-4ac7-8d0f-b8ed214ee97b',
      },
    });

    expect(response.headers.get(correlationIdHeaderName)).toBe(
      '7f62df6c-9122-4ac7-8d0f-b8ed214ee97b',
    );
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: '7f62df6c-9122-4ac7-8d0f-b8ed214ee97b',
        errorCode: 'HTTP_REQUEST_FAILED',
        eventName: 'http.requestFailed',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('does not expose a thrown error to the operational event', async () => {
    const write = vi.fn();
    const app = new Hono<BackendEnvironment>();
    app.use(
      '*',
      createOperationalLoggingMiddleware({
        operationalIdentity,
        operationalLogger: { write },
      }),
    );
    app.get('/throws', () => {
      throw new Error('synthetic private failure');
    });

    const response = await app.request('/throws');

    expect(response.status).toBe(500);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'HTTP_REQUEST_FAILED',
        eventName: 'http.requestFailed',
      }),
    );
    expect(JSON.stringify(write.mock.calls)).not.toContain(
      'synthetic private failure',
    );
  });
});
