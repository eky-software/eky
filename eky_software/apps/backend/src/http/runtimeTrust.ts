import { timingSafeEqual } from 'node:crypto';

import type { ActorContext } from '@eky/auth';
import type { Permission } from '@eky/permissions';
import type { MiddlewareHandler } from 'hono';

import {
  createLocalActorContext,
  type LocalRuntimeIdentity,
} from '../infrastructure/identity/localRuntimeIdentity.js';
import type { HttpRequestOperationalContext } from './httpRequestOperationalContext.js';

export const localRuntimeSessionHeaderName = 'x-eky-local-session';

const runtimeSessionLength = 43;
const runtimeSessionPattern = /^[A-Za-z0-9_-]+$/;
const localOwnerPermissions = Object.freeze([
  'manageCompanySettings',
  'manageInvoiceSettings',
  'manageInvoiceNumberingSeries',
  'manageInvoiceCorrections',
  'manageInvoicePayments',
  'manageCompanyEmailSettings',
  'manageCompanyEmailSecret',
  'sendInvoices',
  'viewActivity',
  'viewDiagnostics',
  'createSupportBundle',
] satisfies readonly Permission[]);

export interface BackendEnvironment {
  Variables: {
    actorContext: ActorContext;
    correlationId: string;
    httpRequestOperationalContext?: HttpRequestOperationalContext;
  };
}

export interface RuntimeTrustObserver {
  invalidSession(correlationId: string): void;
  missingSession(correlationId: string): void;
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
  localRuntimeIdentity: LocalRuntimeIdentity,
  observer?: RuntimeTrustObserver,
): MiddlewareHandler<BackendEnvironment> {
  assertValidRuntimeTrust(runtimeTrust);
  const actorContext = createLocalActorContext(
    localRuntimeIdentity,
    localOwnerPermissions,
  );

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
      const correlationId = context.get('correlationId');
      const receivedSession = context.req.header(localRuntimeSessionHeaderName);
      if (receivedSession === undefined) {
        observer?.missingSession(correlationId);
      } else {
        observer?.invalidSession(correlationId);
      }
      return context.json({ error: 'Authentication required.' }, 401);
    }

    context.set('actorContext', actorContext);
    await next();
  };
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
