import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../observability/operationalEvent.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';
import type { BackendEnvironment } from './runtimeTrust.js';

export const correlationIdHeaderName = 'x-eky-correlation-id';

const correlationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationalLoggingMiddleware(options: {
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
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
      const requestContext = context.get('httpRequestOperationalContext');
      const operationFields =
        requestContext === undefined
          ? { stage: 'handler' }
          : {
              operationId: requestContext.operationId,
              stage: requestContext.stage,
            };
      context.header(correlationIdHeaderName, correlationId);
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            correlationId,
            errorCode: 'HTTP_HANDLER_FAILED',
            eventName: 'http.requestFailed',
            ...operationFields,
            sideEffectState: 'unknown',
          },
          options.operationalIdentity,
        ),
      );
      throw new Error('HTTP request could not be completed.');
    }

    if (context.res.status >= 400) {
      context.header(correlationIdHeaderName, correlationId);
    }

    if (context.res.status >= 500) {
      const requestContext = context.get('httpRequestOperationalContext');
      const operationFields =
        requestContext === undefined
          ? { stage: 'response' }
          : {
              operationId: requestContext.operationId,
              stage: requestContext.stage,
            };
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            correlationId,
            errorCode: 'HTTP_REQUEST_FAILED',
            eventName: 'http.requestFailed',
            ...operationFields,
            sideEffectState: 'unknown',
          },
          options.operationalIdentity,
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
          options.operationalIdentity,
        ),
      );
      return;
    }

    if (
      context.res.status === 400 ||
      context.res.status === 413 ||
      context.res.status === 415
    ) {
      const requestContext = context.get('httpRequestOperationalContext');
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            correlationId,
            errorCode:
              requestContext?.errorCode ?? 'HTTP_REQUEST_INVALID',
            eventName: 'http.invalidBody',
            ...(requestContext === undefined
              ? { stage: 'response' }
              : {
                  operationId: requestContext.operationId,
                  stage: requestContext.stage,
                }),
          },
          options.operationalIdentity,
        ),
      );
    }
  };
}

export function logUnknownRoute(options: {
  correlationId: string;
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  operationalLogger: OperationalLogger;
}): void {
  options.operationalLogger.write(
    createBackendOperationalEvent(
      {
        correlationId: options.correlationId,
        eventName: 'http.unknownRoute',
        stage: 'routing',
      },
      options.operationalIdentity,
    ),
  );
}

export function resolveCorrelationId(value: string | undefined): string {
  const candidate = value?.trim();

  return candidate !== undefined && correlationIdPattern.test(candidate)
    ? candidate
    : randomUUID();
}
