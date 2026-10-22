import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type {
  BackendOperationalEventInput,
  OperationalRuntimeIdentity,
} from '../observability/operationalEvent.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';
import {
  handleUnexpectedHttpError,
  type HttpRequestFailureObserver,
} from './handleUnexpectedHttpError.js';
import type { BackendEnvironment } from './runtimeTrust.js';

export const correlationIdHeaderName = 'x-eky-correlation-id';

const correlationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOperationalLoggingMiddleware(options: {
  httpRequestFailureObserver?: HttpRequestFailureObserver;
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
      if (!context.finalized) {
        throw new Error('HTTP_HANDLER_RESPONSE_MISSING');
      }
    } catch (error) {
      // Hono dispatch handles Error values internally; other thrown values reach here.
      context.res = handleUnexpectedHttpError(
        error,
        context,
        options.httpRequestFailureObserver,
      );
    }

    if (context.res.status >= 400) {
      context.header(correlationIdHeaderName, correlationId);
    }

    if (context.res.status >= 500) {
      const requestContext = context.get('httpRequestOperationalContext');
      const operationFields =
        requestContext === undefined
          ? { stage: context.get('httpHandlerFailed') ? 'handler' : 'response' }
          : {
              operationId: requestContext.operationId,
              stage: requestContext.stage,
            };
      writeHttpOperationalEvent(
        {
          correlationId,
          errorCode: context.get('httpHandlerFailed')
            ? 'HTTP_HANDLER_FAILED'
            : 'HTTP_REQUEST_FAILED',
          eventName: 'http.requestFailed',
          ...operationFields,
          sideEffectState: 'unknown',
        },
        options,
      );
      return;
    }

    if (context.res.status === 403) {
      writeHttpOperationalEvent(
        {
          correlationId,
          eventName: 'permission.denied',
          stage: 'response',
        },
        options,
      );
      return;
    }

    if (
      context.res.status === 400 ||
      context.res.status === 413 ||
      context.res.status === 415
    ) {
      const requestContext = context.get('httpRequestOperationalContext');
      writeHttpOperationalEvent(
        {
          correlationId,
          errorCode: requestContext?.errorCode ?? 'HTTP_REQUEST_INVALID',
          eventName: 'http.invalidBody',
          ...(requestContext === undefined
            ? { stage: 'response' }
            : {
                operationId: requestContext.operationId,
                stage: requestContext.stage,
              }),
        },
        options,
      );
    }
  };
}

export function logUnknownRoute(options: {
  correlationId: string;
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  operationalLogger: OperationalLogger;
}): void {
  writeHttpOperationalEvent(
    {
      correlationId: options.correlationId,
      eventName: 'http.unknownRoute',
      stage: 'routing',
    },
    options,
  );
}

type HttpOperationalEventInput = Extract<BackendOperationalEventInput, {
  eventName: 'http.requestFailed' | 'http.invalidBody' | 'http.unknownRoute' |
    'permission.denied' | 'runtimeSession.invalid' | 'runtimeSession.missing';
}>;

export function writeHttpOperationalEvent(
  input: HttpOperationalEventInput,
  options: {
    operationalIdentity: Readonly<OperationalRuntimeIdentity>;
    operationalLogger: OperationalLogger;
  },
): void {
  try {
    options.operationalLogger.write(
      createBackendOperationalEvent<HttpOperationalEventInput>(input, options.operationalIdentity),
    );
  } catch {
    // The writer owns its failure sink; never retry an uncertain write here.
  }
}

export function resolveCorrelationId(value: string | undefined): string {
  const candidate = value?.trim();

  return candidate !== undefined && correlationIdPattern.test(candidate)
    ? candidate
    : randomUUID();
}
