import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import {
  setHttpRequestFailure,
  setHttpRequestOperation,
  setJsonRequestBodyFailure,
} from './httpRequestOperationalContext.js';
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

  it('does not expose a thrown error, path, stack or request data to the operational event', async () => {
    const write = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const app = new Hono<BackendEnvironment>();
    app.use(
      '*',
      createOperationalLoggingMiddleware({
        operationalIdentity,
        operationalLogger: { write },
      }),
    );
    app.post('/throws', async (context) => {
      setHttpRequestOperation(
        context,
        'invoiceDraft.create',
        'requestValidation',
      );
      await context.req.text();
      const error = new Error(
        'person@example.test C:\\Users\\Private\\invoice.json',
      );
      error.stack =
        'PRIVATE_STACK at C:\\Users\\Private\\invoice.json:1:1';
      throw error;
    });

    const response = await app
      .request('/throws?customer=private-customer', {
        body: JSON.stringify({ subject: 'private invoice subject' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      .finally(() => consoleError.mockRestore());

    expect(response.status).toBe(500);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'HTTP_REQUEST_FAILED',
        eventName: 'http.requestFailed',
        operationId: 'invoiceDraft.create',
        stage: 'requestValidation',
      }),
    );
    const serializedEvents = JSON.stringify(write.mock.calls);
    expect(serializedEvents).not.toContain('person@example.test');
    expect(serializedEvents).not.toContain('C:\\\\Users');
    expect(serializedEvents).not.toContain('PRIVATE_STACK');
    expect(serializedEvents).not.toContain('private-customer');
    expect(serializedEvents).not.toContain('private invoice subject');
  });

  it('records a safe logical operation, stage and error class for a rejected request', async () => {
    const events: BackendOperationalEvent[] = [];
    const app = createTestApp(events);
    app.post('/invoice-drafts', (context) => {
      setHttpRequestOperation(
        context,
        'invoiceDraft.create',
        'bodyParsing',
      );
      setHttpRequestFailure(
        context,
        'INVOICE_DRAFT_REQUEST_INVALID',
        'requestValidation',
      );
      return context.json({ error: 'Safe error.' }, 400);
    });

    const response = await app.request(
      '/invoice-drafts?customer=private-customer',
      {
        body: JSON.stringify({ subject: 'private invoice subject' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(response.status).toBe(400);
    expect(events).toEqual([
      expect.objectContaining({
        errorCode: 'INVOICE_DRAFT_REQUEST_INVALID',
        eventName: 'http.invalidBody',
        operationId: 'invoiceDraft.create',
        stage: 'requestValidation',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('private-customer');
    expect(JSON.stringify(events)).not.toContain('private invoice subject');
  });

  it('classifies unsupported JSON media types without logging the media type', async () => {
    const events: BackendOperationalEvent[] = [];
    const app = createTestApp(events);
    app.post('/invoice-drafts', (context) => {
      setHttpRequestOperation(
        context,
        'invoiceDraft.create',
        'bodyParsing',
      );
      setJsonRequestBodyFailure(context, 'unsupportedMediaType');
      return context.json({ error: 'Safe error.' }, 415);
    });

    const response = await app.request('/invoice-drafts', {
      body: '{}',
      headers: { 'Content-Type': 'text/private-customer-data' },
      method: 'POST',
    });

    expect(response.status).toBe(415);
    expect(events).toEqual([
      expect.objectContaining({
        errorCode: 'HTTP_MEDIA_TYPE_UNSUPPORTED',
        eventName: 'http.invalidBody',
        operationId: 'invoiceDraft.create',
        stage: 'bodyParsing',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(
      'text/private-customer-data',
    );
  });

  it('keeps a generic safe fallback for routes without an operation context', async () => {
    const events: BackendOperationalEvent[] = [];
    const app = createTestApp(events);
    app.post('/legacy', (context) =>
      context.json({ error: 'Safe error.' }, 400),
    );

    const response = await app.request('/legacy', { method: 'POST' });

    expect(response.status).toBe(400);
    expect(events).toEqual([
      expect.objectContaining({
        errorCode: 'HTTP_REQUEST_INVALID',
        eventName: 'http.invalidBody',
        stage: 'response',
      }),
    ]);
    expect(events[0]).not.toHaveProperty('operationId');
  });
});

function createTestApp(
  events: BackendOperationalEvent[],
): Hono<BackendEnvironment> {
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
  return app;
}
