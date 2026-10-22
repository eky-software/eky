import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpRequestFailureCapture } from '../../../../test-reporters/httpRequestFailureCapture.mjs';
import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import { handleUnexpectedHttpError } from './handleUnexpectedHttpError.js';
import { setHttpRequestOperation } from './httpRequestOperationalContext.js';
import { correlationIdHeaderName, createOperationalLoggingMiddleware } from './operationalLogging.js';
import type { BackendEnvironment } from './runtimeTrust.js';

const operationalIdentity = {
  appVersion: '0.0.0', buildRevision: '123456789abc',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
} as const;
const correlationId = '7f62df6c-9122-4ac7-8d0f-b8ed214ee97b';

afterEach(() => vi.restoreAllMocks());

describe('unexpected HTTP exception boundary', () => {
  it('records a handler that finishes without a response before dispatch exits', async () => {
    const write = vi.fn();
    const observer = { captureOriginalException: vi.fn() };
    const app = createBoundaryApp(write, observer);
    app.get('/synthetic', async () => undefined);
    const response = await app.request('/synthetic');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error.' });
    expect(response.headers.get(correlationIdHeaderName)).toMatch(/^[a-f0-9-]{36}$/i);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'HTTP_HANDLER_FAILED', stage: 'handler',
    }));
    expect(observer.captureOriginalException.mock.calls.length).toBe(1);
  });

  it.for(['sync', 'async', 'string', 'object', 'null', 'undefined'])(
    'handles %s without exposing the original value', async (kind, testContext) => {
      const error = kind === 'null' ? null : kind === 'undefined' ? undefined
        : kind === 'string' ? 'F_PRIVATE_MESSAGE'
          : kind === 'object' ? { message: 'F_PRIVATE_MESSAGE' }
            : new Error('F_PRIVATE_MESSAGE', { cause: new Error('F_PRIVATE_CAUSE') });
      const capture = createHttpRequestFailureCapture(testContext);
      const observer = { captureOriginalException: vi.fn(capture.captureOriginalException) };
      const write = vi.fn();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const app = createBoundaryApp(write, observer);
      const handler = () => { throw error; };
      app.get('/synthetic', kind === 'async' ? async () => handler() : handler);

      const response = await app.request('/synthetic?private=F_PRIVATE_QUERY', {
        headers: { [correlationIdHeaderName]: correlationId },
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal server error.' });
      expect(response.headers.get(correlationIdHeaderName)).toBe(correlationId);
      expect(observer.captureOriginalException.mock.calls.length).toBe(1);
      expect(observer.captureOriginalException.mock.calls[0]?.[0] === error).toBe(true);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(expect.objectContaining({
        eventName: 'http.requestFailed', errorCode: 'HTTP_HANDLER_FAILED',
        stage: 'handler', correlationId, sideEffectState: 'unknown',
      }));
      expect(JSON.stringify(write.mock.calls)).not.toContain('F_PRIVATE');
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it('ignores an exception response factory and preserves the logical operation', async () => {
    const getResponse = vi.fn(() => new Response('F_PRIVATE_BODY', {
      status: 418, headers: { 'x-private': 'F_PRIVATE_HEADER' },
    }));
    const error = Object.assign(new Error('F_PRIVATE_MESSAGE'), { getResponse });
    const write = vi.fn();
    const app = createBoundaryApp(write);
    app.get('/synthetic', context => {
      setHttpRequestOperation(context, 'invoiceDraft.create', 'requestValidation');
      throw error;
    });
    const response = await app.request('/synthetic');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error.' });
    expect(response.headers.has('x-private')).toBe(false);
    expect(getResponse).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'HTTP_HANDLER_FAILED', operationId: 'invoiceDraft.create', stage: 'requestValidation',
    }));
  });

  it.each([false, true])('preserves the safe response when evidence throws=%s', async throws => {
    const observer = { captureOriginalException: vi.fn(() => {
      if (throws) throw new Error('F_OBSERVER_ERROR');
    }) };
    const write = vi.fn();
    const app = createBoundaryApp(write, observer);
    app.get('/synthetic', () => { throw new Error('F_PRIVATE_MESSAGE'); });
    const response = await app.request('/synthetic');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error.' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(write.mock.calls)).not.toContain('F_OBSERVER_ERROR');
  });

  it.each([400, 403, 413, 415, 500, 503] as const)(
    'preserves an intentional %i response when the writer fails', async status => {
      for (const afterWrite of [false, true]) {
        const recorded: BackendOperationalEvent[] = [];
        const write = vi.fn((event: BackendOperationalEvent) => {
          if (afterWrite) recorded.push(event);
          throw new Error('F_PRIVATE_WRITER_ERROR');
        });
        const observer = { captureOriginalException: vi.fn() };
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const app = createBoundaryApp(write, observer);
        app.get('/synthetic', context => context.json({ error: 'Safe response.' }, status));
        const response = await app.request('/synthetic');
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: 'Safe response.' });
        expect(write).toHaveBeenCalledTimes(1);
        expect(recorded.length).toBe(afterWrite ? 1 : 0);
        expect(observer.captureOriginalException).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
      }
    },
  );

  it('keeps an intentional 5xx separate from an unhandled exception', async () => {
    const write = vi.fn();
    const app = createBoundaryApp(write);
    app.get('/synthetic', context => context.json({ error: 'Safe response.' }, 503));
    const response = await app.request('/synthetic');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Safe response.' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'HTTP_REQUEST_FAILED', stage: 'response',
    }));
  });

  it.each([false, true])('keeps the original exception when the writer fails afterEffect=%s', async afterEffect => {
    const original = new Error('F_PRIVATE_FIRST_FAILURE');
    const recorded: BackendOperationalEvent[] = [];
    const write = vi.fn((event: BackendOperationalEvent) => {
      if (afterEffect) recorded.push(event);
      throw new Error('F_PRIVATE_SECOND_FAILURE');
    });
    const observer = { captureOriginalException: vi.fn() };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createBoundaryApp(write, observer);
    app.get('/synthetic', () => { throw original; });
    const response = await app.request('/synthetic');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error.' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(recorded.length).toBe(afterEffect ? 1 : 0);
    expect(observer.captureOriginalException.mock.calls.length).toBe(1);
    expect(observer.captureOriginalException.mock.calls[0]?.[0] === original).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

function createBoundaryApp(
  write: (event: BackendOperationalEvent) => void,
  observer?: { captureOriginalException(error: unknown): void },
): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.onError((error, context) => handleUnexpectedHttpError(error, context, observer));
  app.use('*', createOperationalLoggingMiddleware({
    operationalIdentity, operationalLogger: { write },
    ...(observer === undefined ? {} : { httpRequestFailureObserver: observer }),
  }));
  return app;
}
