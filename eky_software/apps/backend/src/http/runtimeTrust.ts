import { timingSafeEqual } from 'node:crypto';

import {
  createActorContext,
  type ActorContext,
} from '@eky/auth';
import { permissionValues } from '@eky/permissions';
import type { MiddlewareHandler } from 'hono';

export const localRuntimeSessionHeaderName = 'x-eky-local-session';

const localActorId = 'dev-user';
const localCompanyId = 'dev-company';
const runtimeSessionLength = 43;
const runtimeSessionPattern = /^[A-Za-z0-9_-]+$/;

export interface BackendEnvironment {
  Variables: {
    actorContext: ActorContext;
  };
}

export interface DevelopmentRuntimeTrust {
  mode: 'development';
}

export interface LocalSessionRuntimeTrust {
  mode: 'localSession';
  sessionSecret: string;
}

export type RuntimeTrust =
  | DevelopmentRuntimeTrust
  | LocalSessionRuntimeTrust;

export function createDevelopmentRuntimeTrust(): DevelopmentRuntimeTrust {
  return Object.freeze({ mode: 'development' });
}

export function resolveRuntimeTrust(
  runtimeTrust: RuntimeTrust | undefined,
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
): RuntimeTrust {
  if (runtimeTrust !== undefined) {
    assertValidRuntimeTrust(runtimeTrust);
    return runtimeTrust;
  }

  if (nodeEnvironment === 'production') {
    throw new Error('Production runtime trust must be configured.');
  }

  return createDevelopmentRuntimeTrust();
}

export function createRuntimeTrustMiddleware(
  runtimeTrust: RuntimeTrust,
): MiddlewareHandler<BackendEnvironment> {
  assertValidRuntimeTrust(runtimeTrust);
  const actorContext = createLocalActorContext();

  return async (context, next) => {
    if (context.req.path === '/health') {
      await next();
      return;
    }

    if (
      runtimeTrust.mode === 'localSession' &&
      !sessionMatches(
        context.req.header(localRuntimeSessionHeaderName),
        runtimeTrust.sessionSecret,
      )
    ) {
      return context.json({ error: 'Authentication required.' }, 401);
    }

    context.set('actorContext', actorContext);
    await next();
  };
}

function createLocalActorContext(): ActorContext {
  return createActorContext({
    actorId: localActorId,
    authenticationMode: 'local',
    companyId: localCompanyId,
    permissions: permissionValues,
  });
}

function assertValidRuntimeTrust(runtimeTrust: RuntimeTrust): void {
  if (
    runtimeTrust.mode === 'localSession' &&
    !isValidRuntimeSession(runtimeTrust.sessionSecret)
  ) {
    throw new Error('Local runtime session configuration is invalid.');
  }
}

function isValidRuntimeSession(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === runtimeSessionLength &&
    runtimeSessionPattern.test(value)
  );
}

function sessionMatches(
  receivedSession: string | undefined,
  expectedSession: string,
): boolean {
  if (!isValidRuntimeSession(receivedSession)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(receivedSession, 'utf8'),
    Buffer.from(expectedSession, 'utf8'),
  );
}
