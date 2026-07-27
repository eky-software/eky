import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError } from '../index.js';

describe('diagnostics API client', () => {
  it('lists the safe projection with a bounded optional limit', async () => {
    const requests: string[] = [];
    const client = createEkyApiClient({
      baseUrl: 'http://127.0.0.1:3000/',
      fetch: async (input) => {
        requests.push(input.toString());
        return jsonResponse({
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
            },
          ],
        });
      },
    });

    await expect(
      client.listDiagnosticEvents({ limit: 20 }),
    ).resolves.toHaveLength(1);
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
});

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
