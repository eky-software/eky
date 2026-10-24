import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { ListDiagnosticEventsInput } from '../application/listDiagnosticEvents.js';
import type { GetRuntimeDiagnosticSummaryInput } from '../application/getRuntimeDiagnosticSummary.js';
import type { PrepareSupportBundleDiagnosticDataInput } from '../application/prepareSupportBundleDiagnosticData.js';
import type { DiagnosticEventPage } from '../domain/diagnosticEventPage.js';
import { DiagnosticBrowseError } from '../domain/diagnosticBrowsePolicy.js';
import { completeDiagnosticReadState, unavailableDiagnosticReadState } from '../domain/diagnosticReadState.js';
import type { RuntimeDiagnosticSummary } from '../domain/runtimeDiagnosticSummary.js';
import type { SupportBundleDiagnosticData } from '../domain/supportBundleDiagnosticData.js';
import { createDiagnosticRoutes } from './diagnosticRoutes.js';

type ListDiagnosticEvents = (
  input: ListDiagnosticEventsInput,
) => Promise<DiagnosticEventPage>;
type GetRuntimeDiagnosticSummary = (
  input: GetRuntimeDiagnosticSummaryInput,
) => Promise<RuntimeDiagnosticSummary>;
type PrepareSupportBundleDiagnosticData = (
  input: PrepareSupportBundleDiagnosticDataInput,
) => Promise<SupportBundleDiagnosticData>;

describe('diagnostic routes', () => {
  it('returns the safe runtime summary from trusted backend context', async () => {
    const getRuntimeDiagnosticSummary =
      vi.fn<GetRuntimeDiagnosticSummary>().mockResolvedValue(
        createRuntimeSummary(),
      );
    const app = createTestApp(
      vi.fn<ListDiagnosticEvents>(),
      vi.fn<PrepareSupportBundleDiagnosticData>(),
      getRuntimeDiagnosticSummary,
    );

    const response = await app.request('/diagnostics/summary');

    expect(response.status).toBe(200);
    expect(getRuntimeDiagnosticSummary).toHaveBeenCalledWith({
      actorContext: expect.objectContaining({
        companyId: 'trusted-company',
      }),
    });
    expect(await response.json()).not.toHaveProperty('databaseFilePath');
  });

  it('rejects all summary query parameters', async () => {
    const getRuntimeDiagnosticSummary = vi.fn<GetRuntimeDiagnosticSummary>();
    const app = createTestApp(
      vi.fn<ListDiagnosticEvents>(),
      vi.fn<PrepareSupportBundleDiagnosticData>(),
      getRuntimeDiagnosticSummary,
    );

    expect(
      (await app.request('/diagnostics/summary?path=private')).status,
    ).toBe(400);
    expect(getRuntimeDiagnosticSummary).not.toHaveBeenCalled();
  });

  it('takes trust context from the backend and returns only the projection', async () => {
    const listDiagnosticEvents = vi.fn<ListDiagnosticEvents>().mockResolvedValue({
      state: 'ready', older: { state: 'end' }, newer: { state: 'end' },
      readState: completeDiagnosticReadState, diagnosticEvents: [
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
    ] });
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
      state: 'ready', older: { state: 'end' }, newer: { state: 'end' },
      readState: completeDiagnosticReadState,
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
        incidentSummaries: [],
        incidentSummariesTruncated: false,
        runtimeSummary: createRuntimeSummary(),
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

  it.each(['limit=1&limit=2', 'limit=1%0A', 'limit=', 'cursor=', 'cursor=private/path',
    'cursor=' + 'a'.repeat(32) + '%0A', 'cursor=' + 'a'.repeat(31), 'cursor=' + 'a'.repeat(33),
    'limit=1&cursor=' + 'a'.repeat(32), 'cursor=' + 'a'.repeat(32) + '&cursor=' + 'b'.repeat(32)])(
    'rejects the ambiguous or malformed query %s before reader admission', async query => {
      const list = vi.fn<ListDiagnosticEvents>();
      const response = await createTestApp(list).request(`/diagnostics/events?${query}`);
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('forwards an opaque continuation and its scanning response without caching', async () => {
    const cursor = 'a'.repeat(32);
    const reply = { state: 'scanning' as const, cursor: 'b'.repeat(32) };
    const list = vi.fn<ListDiagnosticEvents>().mockResolvedValue(reply);
    const response = await createTestApp(list).request(`/diagnostics/events?cursor=${cursor}`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(reply);
    expect(list).toHaveBeenCalledWith({ actorContext: expect.objectContaining({ companyId: 'trusted-company' }), cursor });
  });

  it.each([['diagnostic_browse_stale', 409], ['diagnostic_browse_busy', 429]] as const)(
    'preserves the closed %s error without source details', async (code, status) => {
      const list = vi.fn<ListDiagnosticEvents>().mockRejectedValue(new DiagnosticBrowseError(code));
      const response = await createTestApp(list).request('/diagnostics/events');
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: 'Diagnostic browsing is unavailable.', code });
    },
  );
});

function createTestApp(
  listDiagnosticEvents: ListDiagnosticEvents,
  prepareSupportBundleDiagnosticData: PrepareSupportBundleDiagnosticData =
    vi.fn<PrepareSupportBundleDiagnosticData>(),
  getRuntimeDiagnosticSummary: GetRuntimeDiagnosticSummary =
    vi.fn<GetRuntimeDiagnosticSummary>(),
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
      getRuntimeDiagnosticSummary,
      listDiagnosticEvents,
      prepareSupportBundleDiagnosticData,
    }),
  );
  return app;
}

function createRuntimeSummary(): RuntimeDiagnosticSummary {
  return {
    appVersion: '0.1.0-alpha.1',
    appliedMigrationCount: 42,
    architecture: 'x64',
    buildCreatedAt: '2026-07-28T12:00:00.000Z',
    buildDirty: false,
    buildRevision: 'abcdef123456',
    databaseHealth: 'ok',
    electronVersion: '42.7.0',
    latestErrorAt: null,
    latestMigrationName: '042_example.sql',
    latestSecurityEventAt: null,
    latestWarningAt: null,
    nodeVersion: 'v24.11.0',
    operationalLogNewestMonth: null,
    operationalLogOldestMonth: null,
    operationalLogsAvailable: false,
    operationalLogReadState: unavailableDiagnosticReadState,
    operationalLogTotalBytes: 0,
    platform: 'win32',
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
}
