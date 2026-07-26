import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { ListDiagnosticEventsInput } from '../application/listDiagnosticEvents.js';
import type { PrepareSupportBundleDiagnosticDataInput } from '../application/prepareSupportBundleDiagnosticData.js';
import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';
import type { SupportBundleDiagnosticData } from '../domain/supportBundleDiagnosticData.js';
import { createDiagnosticRoutes } from './diagnosticRoutes.js';

type ListDiagnosticEvents = (
  input: ListDiagnosticEventsInput,
) => Promise<DiagnosticEventItem[]>;
type PrepareSupportBundleDiagnosticData = (
  input: PrepareSupportBundleDiagnosticDataInput,
) => Promise<SupportBundleDiagnosticData>;

describe('diagnostic routes', () => {
  it('takes trust context from the backend and returns only the projection', async () => {
    const listDiagnosticEvents = vi.fn<ListDiagnosticEvents>().mockResolvedValue([
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
    const listDiagnosticEvents = vi.fn<ListDiagnosticEvents>();
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

  it('returns support data only through the dedicated permission-checked service', async () => {
    const prepareSupportBundleDiagnosticData =
      vi.fn<PrepareSupportBundleDiagnosticData>().mockResolvedValue({
        backendVersion: '1.2.3',
        database: {
          appliedMigrationCount: 35,
          health: 'ok',
          latestMigrationName: '035_example.sql',
        },
        diagnosticEvents: [],
        diagnosticPeriodDays: 30,
        truncated: false,
      });
    const app = createTestApp(
      vi.fn<ListDiagnosticEvents>(),
      prepareSupportBundleDiagnosticData,
    );

    const response = await app.request('/diagnostics/support-bundle-data');

    expect(response.status).toBe(200);
    expect(prepareSupportBundleDiagnosticData).toHaveBeenCalledWith({
      actorContext: expect.objectContaining({
        companyId: 'trusted-company',
      }),
    });
  });
});

function createTestApp(
  listDiagnosticEvents: ListDiagnosticEvents,
  prepareSupportBundleDiagnosticData: PrepareSupportBundleDiagnosticData =
    vi.fn<PrepareSupportBundleDiagnosticData>(),
) {
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
  app.route(
    '/',
    createDiagnosticRoutes({
      listDiagnosticEvents,
      prepareSupportBundleDiagnosticData,
    }),
  );
  return app;
}
