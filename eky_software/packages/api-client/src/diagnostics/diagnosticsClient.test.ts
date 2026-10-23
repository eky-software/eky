import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError } from '../index.js';

const completeReadState = { status: 'complete', reasons: [] } as const;

describe('diagnostics API client', () => {
  it.each([
    { eventName: 'invoicePdfArchive.queueFailed', component: 'backend', level: 'warn',
      outcome: 'failure', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED', stage: 'queue',
      retryable: true, sideEffectState: 'none' },
    { eventName: 'invoicePdfArchive.taskQueued', component: 'desktop', level: 'info', outcome: 'success', errorCode: null },
    { eventName: 'invoicePdfArchive.copySucceeded', component: 'desktop', level: 'info', outcome: 'success', errorCode: null, durationMs: 1 },
    { eventName: 'invoicePdfArchive.copyFailed', component: 'desktop', level: 'warn', outcome: 'failure', errorCode: 'ARCHIVE_REQUEST_FAILED', durationMs: 1, retryable: true, sideEffectState: 'none' },
    { eventName: 'invoicePdfArchive.configurationChanged', component: 'desktop', level: 'info', outcome: 'success', errorCode: null, stage: 'enabled' },
  ])('reads the closed $eventName projection', async payload => {
    const event = { category: 'invoicePdfArchive', id: 'synthetic-archive', occurredAt: '2026-10-22T10:00:00.000Z', ...payload };
    const read = (value: unknown) => createEkyApiClient({
      baseUrl: '', fetch: async () => jsonResponse({ diagnosticEvents: [value], readState: completeReadState }),
    }).listDiagnosticEvents();
    await expect(read(event)).resolves.toEqual({ diagnosticEvents: [event], readState: completeReadState });
    for (const change of [
      { category: 'smtp' }, { component: event.component === 'backend' ? 'desktop' : 'backend' },
      { level: 'error' }, { outcome: 'unknown' }, { eventName: 'invoicePdfArchive.unknown' },
      { attemptCount: 1 }, { fingerprint: 'synthetic-fingerprint' },
      { operationId: 'synthetic-invoice' }, { recoveryPointKind: 'daily' },
      { cipherName: 'synthetic-cipher' }, { rawError: 'synthetic-private' },
      { path: '/synthetic/private.pdf' }, { companyId: 'synthetic-company' },
      { errorCode: event.errorCode === null ? 'ARCHIVE_REQUEST_FAILED' : null },
    ]) await expect(read({ ...event, ...change })).rejects.toBeInstanceOf(EkyApiError);
    if (payload.eventName === 'invoicePdfArchive.queueFailed') {
      for (const change of [{ stage: undefined }, { stage: 'copy' }, { retryable: false },
        { sideEffectState: 'unknown' }, { errorCode: 'ARCHIVE_REQUEST_FAILED' }]) {
        await expect(read({ ...event, ...change })).rejects.toBeInstanceOf(EkyApiError);
      }
    }
    if (payload.eventName === 'invoicePdfArchive.copySucceeded') {
      await expect(read({ ...event, durationMs: undefined })).rejects.toBeInstanceOf(EkyApiError);
    }
    if (payload.eventName === 'invoicePdfArchive.configurationChanged') {
      await expect(read({ ...event, stage: 'disabled' })).resolves.toEqual({
        diagnosticEvents: [{ ...event, stage: 'disabled' }], readState: completeReadState,
      });
      await expect(read({ ...event, stage: 'privateDirectory' })).rejects.toBeInstanceOf(EkyApiError);
    }
  });

  it.each(['workspaceBackup.operationFailed', 'workspaceBackup.cleanupFailed'])(
    'retains the safe %s projection', async eventName => {
      const event = {
        category: 'backup', component: 'desktop',
        correlationId: '22222222-2222-4222-8222-222222222222', durationMs: 1,
        errorCode: 'PROFILE_SCHEMA_UNSUPPORTED', eventName, id: 'desktop:safe-failure',
        level: 'error', occurredAt: '2026-10-09T10:00:00.000Z', outcome: 'failure',
        retryable: false, sideEffectState: 'unknown', stage: 'import',
      };
      const client = createEkyApiClient({ baseUrl: '', fetch: async () => jsonResponse({ diagnosticEvents: [event], readState: completeReadState }) });
      await expect(client.listDiagnosticEvents()).resolves.toEqual({ diagnosticEvents: [event], readState: completeReadState });
      for (const errorCode of [
        'unknown', 'PROFILE_SCHEMA_UNSUPPORTED', 'MIGRATION_HISTORY_INVALID',
        'PROFILE_INSPECTION_LIMIT_EXCEEDED', 'PROFILE_INSPECTION_TIMEOUT',
        'PROFILE_INSPECTION_PROTOCOL_INVALID', 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
        'PROFILE_SNAPSHOT_DATABASE_INVALID', 'PROFILE_SNAPSHOT_MIGRATIONS_INVALID',
        'PROFILE_SNAPSHOT_ARTIFACTS_INVALID', 'WORKSPACE_CANDIDATE_SOURCE_MISMATCH',
        'WORKSPACE_CANDIDATE_DATABASE_CHANGED', 'WORKSPACE_CANDIDATE_DATABASE_INVALID',
        'WORKSPACE_CANDIDATE_DATABASE_CLOSE_FAILED', 'WORKSPACE_CANDIDATE_OPERATION_CANCELLED',
      ]) {
        const knownCause = createEkyApiClient({ baseUrl: '', fetch: async () => jsonResponse({
          diagnosticEvents: [{ ...event, errorCode }],
          readState: completeReadState,
        }) });
        await expect(knownCause.listDiagnosticEvents()).resolves.toEqual({
          diagnosticEvents: [{ ...event, errorCode }], readState: completeReadState,
        });
      }
      for (const change of [
        { rawError: 'synthetic private message' },
        { errorCode: 'syntheticPrivateMessage' },
        { errorCode: null },
        { stage: 'syntheticPrivateStage' },
        { stage: undefined },
        { correlationId: undefined },
        { durationMs: undefined },
        { retryable: true },
        { sideEffectState: 'rolledBack' },
        { category: 'smtp' },
        { component: 'backend' },
        { level: 'info' },
        { outcome: 'success' },
        { fingerprint: 'syntheticPrivateFingerprint' },
        { operationId: 'syntheticPrivateOperation' },
        { cipherName: 'syntheticPrivateCipher' },
      ]) {
        const invalid = createEkyApiClient({ baseUrl: '', fetch: async () => jsonResponse({
          diagnosticEvents: [{ ...event, ...change }],
          readState: completeReadState,
        }) });
        await expect(invalid.listDiagnosticEvents()).rejects.toBeInstanceOf(EkyApiError);
      }
      const unknown = createEkyApiClient({ baseUrl: '', fetch: async () => jsonResponse({
        diagnosticEvents: [{ ...event, errorCode: 'unknown', stage: 'replace' }],
        readState: completeReadState,
      }) });
      await expect(unknown.listDiagnosticEvents()).resolves.toEqual({
        diagnosticEvents: [{ ...event, errorCode: 'unknown', stage: 'replace' }],
        readState: completeReadState,
      });
    },
  );

  it('reads the strict safe runtime summary contract', async () => {
    const requests: string[] = [];
    const client = createEkyApiClient({
      baseUrl: 'http://127.0.0.1:3000/',
      fetch: async (input) => {
        requests.push(input.toString());
        return jsonResponse(createRuntimeSummary());
      },
    });

    await expect(client.getDiagnosticSummary()).resolves.toEqual(
      createRuntimeSummary(),
    );
    expect(requests).toEqual([
      'http://127.0.0.1:3000/diagnostics/summary',
    ]);
  });

  it('rejects paths and unknown fields in a runtime summary', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          ...createRuntimeSummary(),
          databaseFilePath: 'C:\\private\\eky.sqlite',
        }),
    });

    await expect(client.getDiagnosticSummary()).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });

  it('lists the safe projection with a bounded optional limit', async () => {
    const requests: string[] = [];
    const client = createEkyApiClient({
      baseUrl: 'http://127.0.0.1:3000/',
      fetch: async (input) => {
        requests.push(input.toString());
        return jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              appVersion: '0.1.0-alpha.1',
              buildRevision: 'abcdef123456',
              category: 'smtp',
              component: 'backend',
              correlationId: '11111111-1111-4111-8111-111111111111',
              durationMs: 120,
              errorCode: 'SMTP_TLS_FAILED',
              eventName: 'smtp.tlsFailed',
              fingerprint: 'smtp.tlsFailed:SMTP_TLS_FAILED',
              id: 'backend:event-1',
              level: 'error',
              occurredAt: '2026-07-27T12:00:00.000Z',
              operationId: 'send-attempt-1',
              outcome: 'failure',
              retryable: true,
              runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
              sideEffectState: 'none',
              stage: 'tlsHandshake',
            },
          ],
        });
      },
    });

    await expect(
      client.listDiagnosticEvents({ limit: 20 }),
    ).resolves.toEqual({
      diagnosticEvents: [expect.objectContaining({
        correlationId: '11111111-1111-4111-8111-111111111111',
        durationMs: 120,
        retryable: true,
        stage: 'tlsHandshake',
      })],
      readState: completeReadState,
    });
    expect(requests).toEqual([
      'http://127.0.0.1:3000/diagnostics/events?limit=20',
    ]);
  });

  it('rejects excessive limits before a request', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse({}),
    });

    await expect(
      client.listDiagnosticEvents({ limit: 201 }),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('reads the safe recovery diagnostic projection', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              category: 'recoveryPoint',
              component: 'desktop',
              correlationId: '33333333-3333-4333-8333-333333333333',
              errorCode: 'RECOVERY_POINT_SOURCE_UNHEALTHY',
              eventName: 'recoveryPoint.failed',
              id: 'desktop:recovery-event-1',
              level: 'warn',
              occurredAt: '2026-07-27T12:00:00.000Z',
              outcome: 'failure',
              recoveryPointKind: 'daily',
              retryable: true,
              sideEffectState: 'unknown',
              stage: 'creation',
            },
          ],
        }),
    });

    await expect(client.listDiagnosticEvents()).resolves.toEqual({
      diagnosticEvents: [expect.objectContaining({
        eventName: 'recoveryPoint.failed',
        recoveryPointKind: 'daily',
      })],
      readState: completeReadState,
    });
  });

  it('accepts the portable backup and restore recovery event contracts', async () => {
    const eventNames = [
      'backup.started',
      'backup.completed',
      'backup.failed',
      'backup.inspectionCompleted',
      'backup.inspectionFailed',
      'restore.activationFailed',
      'restore.recoveryRequired',
    ] as const;
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: eventNames.map((eventName, index) => {
            const failed =
              eventName === 'backup.failed' ||
              eventName === 'backup.inspectionFailed' ||
              eventName === 'restore.activationFailed' ||
              eventName === 'restore.recoveryRequired';

            return {
              category: eventName.startsWith('backup.') ? 'backup' : 'restore',
              component: 'desktop',
              correlationId: '33333333-3333-4333-8333-333333333333',
              errorCode: eventName === 'restore.recoveryRequired'
                ? 'PROFILE_RESTORE_RECOVERY_REQUIRED'
                : failed ? 'PROFILE_RECOVERY_FAILED' : null,
              eventName,
              id: `desktop:profile-event-${String(index + 1)}`,
              level: eventName === 'backup.inspectionFailed'
                ? 'warn' : failed ? 'error' : 'info',
              occurredAt: `2026-08-09T10:00:0${String(index)}.000Z`,
              outcome: failed ? 'failure' : 'success',
              ...(eventName === 'restore.activationFailed' ? { durationMs: 1 } : {}),
              ...(failed
                ? {
                    retryable: false,
                    sideEffectState: 'unknown',
                  }
                : {}),
              stage: eventName.startsWith('backup.')
                ? 'portable'
                : eventName === 'restore.recoveryRequired' ? 'activationRollback' : 'activation',
            };
          }),
        }),
    });

    await expect(client.listDiagnosticEvents()).resolves.toEqual({
      diagnosticEvents: eventNames.map((eventName) =>
        expect.objectContaining({ eventName }),
      ),
      readState: completeReadState,
    });
  });

  it('accepts only the public SMTP TLS diagnostic projection', async () => {
    const peerCertificateFingerprint256 = Array.from(
      { length: 32 },
      (_, index) =>
        index.toString(16).padStart(2, '0').toUpperCase(),
    ).join(':');
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              category: 'smtp',
              cipherName: 'TLS_AES_256_GCM_SHA384',
              component: 'backend',
              durationMs: 25,
              errorCode: null,
              eventName: 'smtp.connectionSecured',
              id: 'backend:event-1',
              level: 'info',
              occurredAt: '2026-07-27T12:00:00.000Z',
              outcome: 'success',
              peerCertificateFingerprint256,
              smtpProfile: 'dnaSmtp',
              stage: 'connect',
              tlsVersion: 'TLSv1.3',
            },
          ],
        }),
    });

    await expect(client.listDiagnosticEvents()).resolves.toEqual({
      diagnosticEvents: [expect.objectContaining({
        cipherName: 'TLS_AES_256_GCM_SHA384',
        eventName: 'smtp.connectionSecured',
        peerCertificateFingerprint256,
        smtpProfile: 'dnaSmtp',
        tlsVersion: 'TLSv1.3',
      })],
      readState: completeReadState,
    });
  });

  it.each([
    ['remoteAddress', '192.0.2.10'],
    ['targetPort', 465],
    ['peerCertificateFingerprint256', 'invalid'],
    ['smtpProfile', 'other'],
    ['tlsVersion', 'TLSv1.1'],
  ])('rejects non-public or invalid SMTP field %s', async (field, value) => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              category: 'smtp',
              component: 'backend',
              errorCode: null,
              eventName: 'smtp.connectionSecured',
              id: 'backend:event-1',
              level: 'info',
              occurredAt: '2026-07-27T12:00:00.000Z',
              outcome: 'success',
              [field]: value,
            },
          ],
        }),
    });

    await expect(client.listDiagnosticEvents()).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });

  it('accepts the packaged startup and retention event contract', async () => {
    const eventNames = [
      'backend.starting',
      'backend.started',
      'database.opened',
      'migration.completed',
      'operationalLog.retentionCompleted',
      'businessAudit.retentionCompleted',
      'businessAudit.retentionFailed',
      'desktop.started',
    ] as const;
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: eventNames.map((eventName, index) => ({
            category: diagnosticCategory(eventName),
            component: eventName === 'desktop.started' ? 'desktop' : 'backend',
            errorCode:
              eventName === 'businessAudit.retentionFailed'
                ? 'BUSINESS_AUDIT_RETENTION_FAILED'
                : null,
            eventName,
            id: `${eventName === 'desktop.started' ? 'desktop' : 'backend'}:event-${String(index + 1)}`,
            level:
              eventName === 'businessAudit.retentionFailed' ? 'warn' : 'info',
            occurredAt: `2026-07-27T12:00:${String(index).padStart(2, '0')}.000Z`,
            outcome:
              eventName === 'businessAudit.retentionFailed'
                ? 'failure'
                : 'success',
          })),
        }),
    });

    await expect(client.listDiagnosticEvents()).resolves.toEqual({
      diagnosticEvents: eventNames.map((eventName) =>
        expect.objectContaining({ eventName }),
      ),
      readState: completeReadState,
    });
  });

  it('rejects raw metadata and unknown event names', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              category: 'smtp',
              component: 'backend',
              errorCode: null,
              eventName: 'smtp.rawProviderResponse',
              id: 'backend:event-1',
              level: 'error',
              occurredAt: '2026-07-27T12:00:00.000Z',
              outcome: 'failure',
              rawMetadata: { email: 'must-not-be-exposed@example.test' },
            },
          ],
        }),
    });

    await expect(client.listDiagnosticEvents()).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });

  it.each([
    ['correlationId', 'not-a-uuid'],
    ['runtimeInstanceId', 'not-a-uuid'],
    ['durationMs', -1],
    ['retryable', 'true'],
    ['sideEffectState', 'partlyCommitted'],
    ['fingerprint', 'contains a space'],
  ])('rejects invalid optional diagnostic field %s', async (field, value) => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              category: 'smtp',
              component: 'backend',
              errorCode: 'SMTP_TLS_FAILED',
              eventName: 'smtp.tlsFailed',
              id: 'backend:event-1',
              level: 'error',
              occurredAt: '2026-07-27T12:00:00.000Z',
              outcome: 'failure',
              [field]: value,
            },
          ],
        }),
    });

    await expect(client.listDiagnosticEvents()).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });

  it('accepts the operational log folder capability events', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            'operationalLogFolder.opened',
            'operationalLogFolder.openFailed',
            'operationalLogFolder.requestBlocked',
          ].map((eventName, index) => ({
            category:
              eventName === 'operationalLogFolder.requestBlocked'
                ? 'security'
                : 'operationalLogFolder',
            component: 'desktop',
            errorCode:
              eventName === 'operationalLogFolder.opened'
                ? null
                : 'OPERATIONAL_LOG_FOLDER_OPEN_FAILED',
            eventName,
            id: `desktop:log-folder-${String(index)}`,
            level:
              eventName === 'operationalLogFolder.opened'
                ? 'info'
                : eventName === 'operationalLogFolder.requestBlocked'
                  ? 'warn'
                  : 'error',
            occurredAt: `2026-07-27T13:00:0${String(index)}.000Z`,
            outcome:
              eventName === 'operationalLogFolder.opened'
                ? 'success'
                : eventName === 'operationalLogFolder.requestBlocked'
                  ? 'blocked'
                  : 'failure',
          })),
        }),
    });

    expect((await client.listDiagnosticEvents()).diagnosticEvents).toHaveLength(3);
  });

  it('accepts the classified desktop permission request event', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              category: 'security',
              component: 'desktop',
              errorCode: null,
              eventName: 'electron.permissionRequestBlocked',
              id: 'desktop:permission-request-1',
              level: 'warn',
              occurredAt: '2026-07-27T13:00:00.000Z',
              outcome: 'blocked',
            },
          ],
        }),
    });

    expect((await client.listDiagnosticEvents()).diagnosticEvents).toHaveLength(1);
  });

  it('accepts the safe desktop bootstrap failure projection', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          readState: completeReadState,
          diagnosticEvents: [
            {
              category: 'runtime',
              component: 'desktop',
              errorCode: 'DESKTOP_START_FAILED',
              eventName: 'desktop.bootstrapFailed',
              id: 'desktop:bootstrap-failure-1',
              level: 'error',
              occurredAt: '2026-07-27T13:00:00.000Z',
              outcome: 'failure',
            },
          ],
        }),
    });

    expect((await client.listDiagnosticEvents()).diagnosticEvents).toHaveLength(1);
  });
});

function createRuntimeSummary() {
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
    operationalLogReadState: { status: 'unavailable', reasons: ['notConfigured'] },
    operationalLogsAvailable: false,
    operationalLogTotalBytes: 0,
    platform: 'win32',
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function diagnosticCategory(eventName: string): string {
  if (eventName.startsWith('businessAudit.')) {
    return 'businessAudit';
  }
  if (eventName.startsWith('operationalLog.')) {
    return 'operationalLog';
  }
  if (eventName.startsWith('database.')) {
    return 'database';
  }
  if (eventName.startsWith('migration.')) {
    return 'migration';
  }
  return 'runtime';
}
