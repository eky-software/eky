import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError } from '../index.js';

describe('diagnostics API client', () => {
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
    ).resolves.toEqual([
      expect.objectContaining({
        correlationId: '11111111-1111-4111-8111-111111111111',
        durationMs: 120,
        retryable: true,
        stage: 'tlsHandshake',
      }),
    ]);
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

    await expect(client.listDiagnosticEvents()).resolves.toEqual([
      expect.objectContaining({
        eventName: 'recoveryPoint.failed',
        recoveryPointKind: 'daily',
      }),
    ]);
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
              errorCode: failed ? 'PROFILE_RECOVERY_FAILED' : null,
              eventName,
              id: `desktop:profile-event-${String(index + 1)}`,
              level: failed ? 'error' : 'info',
              occurredAt: `2026-08-09T10:00:0${String(index)}.000Z`,
              outcome: failed ? 'failure' : 'success',
              ...(failed
                ? {
                    retryable: false,
                    sideEffectState: 'unknown',
                  }
                : {}),
              stage: eventName.startsWith('backup.')
                ? 'portable'
                : 'activation',
            };
          }),
        }),
    });

    await expect(client.listDiagnosticEvents()).resolves.toEqual(
      eventNames.map((eventName) =>
        expect.objectContaining({ eventName }),
      ),
    );
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

    await expect(client.listDiagnosticEvents()).resolves.toEqual([
      expect.objectContaining({
        cipherName: 'TLS_AES_256_GCM_SHA384',
        eventName: 'smtp.connectionSecured',
        peerCertificateFingerprint256,
        smtpProfile: 'dnaSmtp',
        tlsVersion: 'TLSv1.3',
      }),
    ]);
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

    await expect(client.listDiagnosticEvents()).resolves.toEqual(
      eventNames.map((eventName) =>
        expect.objectContaining({ eventName }),
      ),
    );
  });

  it('rejects raw metadata and unknown event names', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
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

    await expect(client.listDiagnosticEvents()).resolves.toHaveLength(3);
  });

  it('accepts the classified desktop permission request event', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
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

    await expect(client.listDiagnosticEvents()).resolves.toHaveLength(1);
  });

  it('accepts the safe desktop bootstrap failure projection', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
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

    await expect(client.listDiagnosticEvents()).resolves.toHaveLength(1);
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
