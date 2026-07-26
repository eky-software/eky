import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';
import type { BackendEnvironment } from './runtimeTrust.js';

export const correlationIdHeaderName = 'x-eky-correlation-id';

const correlationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationalLoggingMiddleware(options: {
  appVersion: string;
  operationalLogger: OperationalLogger;
}): MiddlewareHandler<BackendEnvironment> {
  return async (context, next) => {
    const correlationId = resolveCorrelationId(
      context.req.header(correlationIdHeaderName),
    );
    context.set('correlationId', correlationId);

    try {
      await next();
    } catch {
      context.header(correlationIdHeaderName, correlationId);
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            correlationId,
            errorCode: 'HTTP_HANDLER_FAILED',
            eventName: 'http.requestFailed',
            sideEffectState: 'unknown',
            stage: 'handler',
          },
          { appVersion: options.appVersion },
        ),
      );
      throw new Error('HTTP request could not be completed.');
    }

    if (context.res.status >= 400) {
      context.header(correlationIdHeaderName, correlationId);
    }

    if (context.res.status >= 500) {
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            correlationId,
            errorCode: 'HTTP_REQUEST_FAILED',
            eventName: 'http.requestFailed',
            sideEffectState: 'unknown',
            stage: 'response',
          },
          { appVersion: options.appVersion },
        ),
      );
      return;
    }

    if (context.res.status === 403) {
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            correlationId,
            eventName: 'permission.denied',
            stage: 'response',
          },
          { appVersion: options.appVersion },
        ),
      );
      return;
    }

    if (context.res.status === 400) {
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            correlationId,
            eventName: 'http.invalidBody',
            stage: 'response',
          },
          { appVersion: options.appVersion },
        ),
      );
    }
  };
}

export function logUnknownRoute(options: {
  appVersion: string;
  correlationId: string;
  operationalLogger: OperationalLogger;
}): void {
  options.operationalLogger.write(
    createBackendOperationalEvent(
      {
        correlationId: options.correlationId,
        eventName: 'http.unknownRoute',
        stage: 'routing',
      },
      { appVersion: options.appVersion },
    ),
  );
}

export function resolveCorrelationId(value: string | undefined): string {
  const candidate = value?.trim();

  return candidate !== undefined && correlationIdPattern.test(candidate)
    ? candidate
    : randomUUID();
}
