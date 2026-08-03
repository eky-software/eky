import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  createRuntimeTrustMiddleware,
  localRuntimeSessionHeaderName,
  resolveRuntimeTrust,
  type BackendEnvironment,
} from './runtimeTrust.js';
import { createLocalRuntimeIdentity } from '../infrastructure/identity/localRuntimeIdentity.js';

const currentSession = 'a'.repeat(43);
const localRuntimeIdentity = createLocalRuntimeIdentity({
  actorId: 'local-owner',
  companyId: 'local-company-test',
  installationId: 'b'.repeat(32),
});

describe('backend runtime trust', () => {
  it('rejects missing, malformed and stale local sessions', async () => {
    const app = createTestApp(currentSession);

    const missingResponse = await app.request('/protected');
    const malformedResponse = await app.request('/protected', {
      headers: { [localRuntimeSessionHeaderName]: 'too-short' },
    });
    const staleResponse = await app.request('/protected', {
      headers: { [localRuntimeSessionHeaderName]: 'b'.repeat(43) },
    });

    expect(missingResponse.status).toBe(401);
    expect(malformedResponse.status).toBe(401);
    expect(staleResponse.status).toBe(401);
    await expect(missingResponse.json()).resolves.toEqual({
      error: 'Authentication required.',
    });
  });

  it('creates ActorContext only after the local session is verified', async () => {
    const app = createTestApp(currentSession);
    const response = await app.request('/protected', {
      headers: { [localRuntimeSessionHeaderName]: currentSession },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      actorId: 'local-owner',
      authenticationMode: 'local',
      companyId: 'local-company-test',
      permissions: [
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
      ],
    });
  });

  it('keeps the health endpoint available for process readiness only', async () => {
    const app = createTestApp(currentSession);
    const response = await app.request('/health');

    expect(response.status).toBe(200);
  });

  it('allows the explicit synthetic development profile', async () => {
    const app = new Hono<BackendEnvironment>();
    app.use(
      '*',
      createRuntimeTrustMiddleware(
        { mode: 'development' },
        localRuntimeIdentity,
      ),
    );
    app.get('/protected', (context) =>
      context.json(context.get('actorContext')),
    );

    expect((await app.request('/protected')).status).toBe(200);
  });

  it('fails closed when production starts without runtime trust', () => {
    expect(() => resolveRuntimeTrust(undefined, 'production')).toThrow(
      'Production runtime trust must be configured.',
    );
    expect(resolveRuntimeTrust(undefined, 'development')).toEqual({
      mode: 'development',
    });
  });

  it('rejects malformed configured session values before serving requests', () => {
    expect(() =>
      createRuntimeTrustMiddleware({
        mode: 'localSession',
        sessionSecret: 'too-short',
      }, localRuntimeIdentity),
    ).toThrow('Local runtime session configuration is invalid.');
  });
});

function createTestApp(sessionSecret: string): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.use(
    '*',
    createRuntimeTrustMiddleware(
      { mode: 'localSession', sessionSecret },
      localRuntimeIdentity,
    ),
  );
  app.get('/health', (context) => context.json({ status: 'ok' }));
  app.get('/protected', (context) =>
    context.json(context.get('actorContext')),
  );

  return app;
}
