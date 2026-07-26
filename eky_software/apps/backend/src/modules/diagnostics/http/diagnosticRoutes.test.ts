import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { createDiagnosticRoutes } from './diagnosticRoutes.js';

describe('diagnostic routes', () => {
  it('takes trust context from the backend and returns only the projection', async () => {
    const listDiagnosticEvents = vi.fn().mockResolvedValue([
      {
        category: 'smtp',
        component: 'backend',
        errorCode: 'SMTP_TLS_FAILED',
        eventName: 'smtp.tlsFailed',
        id: 'backend:event-1',
        level: 'error',
        occurredAt: '2026-07-27T12:00:00.000Z',
        outcome: 'failure',
      },
    ]);
    const app = createTestApp(listDiagnosticEvents);

    const response = await app.request('/diagnostics/events?limit=20');

    expect(response.status).toBe(200);
    expect(listDiagnosticEvents).toHaveBeenCalledWith({
      actorContext: expect.objectContaining({
        companyId: 'trusted-company',
      }),
      limit: 20,
    });
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      diagnosticEvents: [
        expect.not.objectContaining({
          companyId: expect.anything(),
          rawEvent: expect.anything(),
          stack: expect.anything(),
        }),
      ],
    });
  });

  it('rejects path, company and malformed query input', async () => {
    const listDiagnosticEvents = vi.fn();
    const app = createTestApp(listDiagnosticEvents);

    expect(
      (
        await app.request(
          '/diagnostics/events?path=../../secret&companyId=other',
        )
      ).status,
    ).toBe(400);
    expect((await app.request('/diagnostics/events?limit=201')).status).toBe(
      400,
    );
    expect(listDiagnosticEvents).not.toHaveBeenCalled();
  });
});

function createTestApp(listDiagnosticEvents: ReturnType<typeof vi.fn>) {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set('actorContext', {
      actorId: 'actor-1',
      authenticationMode: 'local',
      companyId: 'trusted-company',
      permissions: ['viewDiagnostics'],
    });
    context.set('correlationId', 'correlation-1');
    await next();
  });
  app.route('/', createDiagnosticRoutes({ listDiagnosticEvents }));
  return app;
}

