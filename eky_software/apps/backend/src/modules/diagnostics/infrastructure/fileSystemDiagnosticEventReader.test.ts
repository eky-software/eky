import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { createBackendOperationalEvent } from '../../../observability/createOperationalEvent.js';
import { FileSystemDiagnosticEventReader } from './fileSystemDiagnosticEventReader.js';

const roots: string[] = [];

describe('FileSystemDiagnosticEventReader', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('combines revalidated backend and desktop events as a safe projection', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2026-07-001.jsonl',
      [
        createBackendOperationalEvent(
          {
            companyId: 'must-not-be-returned',
            entityId: 'must-not-be-returned',
            entityType: 'invoice',
            errorCode: 'PDF_FAILED',
            eventName: 'invoicePdf.generationFailed',
          },
          {
            appVersion: '1.0.0',
            buildRevision: '123456789abc',
            eventId: 'backend-event-1',
            runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
            timestamp: '2026-07-27T10:00:00.000Z',
          },
        ),
      ],
    );
    writeLines(
      logsRoot,
      'security',
      'desktop-security-2026-07-001.jsonl',
      [
        createDesktopEvent({
          eventId: 'desktop-event-1',
          eventName: 'electron.permissionDenied',
          timestamp: '2026-07-27T11:00:00.000Z',
        }),
      ],
    );

    const reader = new FileSystemDiagnosticEventReader(logsRoot);

    await expect(reader.listRecentDiagnosticEvents(10)).resolves.toEqual([
      {
        category: 'security',
        component: 'desktop',
        errorCode: null,
        eventName: 'electron.permissionDenied',
        id: 'desktop:desktop-event-1',
        level: 'warn',
        occurredAt: '2026-07-27T11:00:00.000Z',
        outcome: 'blocked',
      },
      {
        category: 'invoicePdf',
        component: 'backend',
        errorCode: 'PDF_FAILED',
        eventName: 'invoicePdf.generationFailed',
        id: 'backend:backend-event-1',
        level: 'error',
        occurredAt: '2026-07-27T10:00:00.000Z',
        outcome: 'failure',
      },
    ]);
  });

  it('ignores malformed, sensitive and unknown files without exposing raw data', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'desktop',
      'desktop-warning-error-2026-07-001.jsonl',
      [
        '{"component":"desktop","password":"plain-text"}',
        '{"component":"desktop","eventName":"unknown.event"}',
        '{"component":',
      ],
    );
    writeFileSync(
      join(logsRoot, 'desktop', 'arbitrary-user-file.jsonl'),
      JSON.stringify({ email: 'person@example.test' }),
      'utf8',
    );
    const reader = new FileSystemDiagnosticEventReader(logsRoot);

    await expect(reader.listRecentDiagnosticEvents(10)).resolves.toEqual([]);
  });

  it('projects the packaged startup and retention event contract while ignoring an old unknown line', async () => {
    const logsRoot = createLogsRoot();
    const backendEvents = [
      createBackendOperationalEvent(
        { eventName: 'backend.starting' },
        eventOptions('backend-starting', '2026-07-27T09:00:00.000Z'),
      ),
      createBackendOperationalEvent(
        { eventName: 'backend.started' },
        eventOptions('backend-started', '2026-07-27T09:00:01.000Z'),
      ),
      createBackendOperationalEvent(
        { eventName: 'database.opened' },
        eventOptions('database-opened', '2026-07-27T09:00:02.000Z'),
      ),
      createBackendOperationalEvent(
        { eventName: 'migration.completed', stage: '036_observability.sql' },
        eventOptions('migration-completed', '2026-07-27T09:00:03.000Z'),
      ),
      createBackendOperationalEvent(
        {
          deletedByteCount: 0,
          deletedFileCount: 0,
          eventName: 'operationalLog.retentionCompleted',
        },
        eventOptions(
          'operational-retention-completed',
          '2026-07-27T09:00:04.000Z',
        ),
      ),
      createBackendOperationalEvent(
        {
          deletedEventCount: 0,
          eventName: 'businessAudit.retentionCompleted',
        },
        eventOptions(
          'business-retention-completed',
          '2026-07-27T09:00:05.000Z',
        ),
      ),
      createBackendOperationalEvent(
        {
          errorCode: 'BUSINESS_AUDIT_RETENTION_FAILED',
          eventName: 'businessAudit.retentionFailed',
        },
        eventOptions(
          'business-retention-failed',
          '2026-07-27T09:00:06.000Z',
        ),
      ),
    ];
    writeLines(
      logsRoot,
      'backend',
      'backend-info-2026-07-001.jsonl',
      backendEvents,
    );
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2026-07-001.jsonl',
      [
        {
          ...backendEvents[0],
          eventId: 'old-unknown-event',
          eventName: 'backend.legacyUnknown',
        },
      ],
    );
    writeLines(
      logsRoot,
      'desktop',
      'desktop-info-2026-07-001.jsonl',
      [
        createDesktopEvent({
          eventId: 'desktop-started',
          eventName: 'desktop.started',
          timestamp: '2026-07-27T09:00:07.000Z',
        }),
      ],
    );

    const events =
      await new FileSystemDiagnosticEventReader(
        logsRoot,
      ).listRecentDiagnosticEvents(20);

    expect(events.map((event) => event.eventName)).toEqual([
      'desktop.started',
      'businessAudit.retentionFailed',
      'businessAudit.retentionCompleted',
      'operationalLog.retentionCompleted',
      'migration.completed',
      'database.opened',
      'backend.started',
      'backend.starting',
    ]);
    expect(events).not.toContainEqual(
      expect.objectContaining({ eventName: 'backend.legacyUnknown' }),
    );
  });

  it('projects the operational log folder capability events without their internal metadata', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'desktop',
      'desktop-warning-error-2026-07-001.jsonl',
      [
        createDesktopOperationalEventFixture({
          category: 'runtime',
          errorCode: 'DESKTOP_START_FAILED',
          eventId: 'desktop-bootstrap-failed',
          eventName: 'desktop.bootstrapFailed',
          level: 'error',
          outcome: 'failure',
          timestamp: '2026-07-27T10:04:00.000Z',
        }),
        createDesktopOperationalEventFixture({
          category: 'operationalLogFolder',
          errorCode: 'OPERATIONAL_LOG_FOLDER_OPEN_FAILED',
          eventId: 'log-folder-failed',
          eventName: 'operationalLogFolder.openFailed',
          level: 'error',
          outcome: 'failure',
          timestamp: '2026-07-27T10:00:00.000Z',
        }),
      ],
    );
    writeLines(
      logsRoot,
      'security',
      'desktop-security-2026-07-001.jsonl',
      [
        createDesktopOperationalEventFixture({
          category: 'security',
          errorCode: 'OPERATIONAL_LOG_FOLDER_FORBIDDEN',
          eventId: 'log-folder-blocked',
          eventName: 'operationalLogFolder.requestBlocked',
          level: 'warn',
          outcome: 'blocked',
          timestamp: '2026-07-27T10:01:00.000Z',
        }),
        {
          ...createDesktopOperationalEventFixture({
            category: 'security',
            eventId: 'permission-request-blocked',
            eventName: 'electron.permissionRequestBlocked',
            level: 'warn',
            outcome: 'blocked',
            timestamp: '2026-07-27T10:03:00.000Z',
          }),
          frameClass: 'mainFrame',
          originClass: 'eky',
          permissionType: 'notifications',
          stage: 'request',
        },
      ],
    );
    writeLines(
      logsRoot,
      'desktop',
      'desktop-info-2026-07-001.jsonl',
      [
        createDesktopOperationalEventFixture({
          category: 'operationalLogFolder',
          eventId: 'log-folder-opened',
          eventName: 'operationalLogFolder.opened',
          level: 'info',
          outcome: 'success',
          timestamp: '2026-07-27T10:02:00.000Z',
        }),
      ],
    );

    const events =
      await new FileSystemDiagnosticEventReader(
        logsRoot,
      ).listRecentDiagnosticEvents(10);

    expect(events.map((event) => event.eventName)).toEqual([
      'desktop.bootstrapFailed',
      'electron.permissionRequestBlocked',
      'operationalLogFolder.opened',
      'operationalLogFolder.requestBlocked',
      'operationalLogFolder.openFailed',
    ]);
    expect(JSON.stringify(events)).not.toContain('shellOpen');
  });

  it('requires composition to supply an absolute logs root', () => {
    expect(() => new FileSystemDiagnosticEventReader('relative/logs')).toThrow(
      'Diagnostic logs root must be absolute.',
    );
  });
});

function createLogsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-diagnostics-'));
  const logsRoot = join(root, 'logs');
  roots.push(root);
  for (const directory of ['backend', 'desktop', 'security']) {
    mkdirSync(join(logsRoot, directory), { recursive: true });
  }
  return logsRoot;
}

function writeLines(
  logsRoot: string,
  directory: string,
  fileName: string,
  values: unknown[],
): void {
  writeFileSync(
    join(logsRoot, directory, fileName),
    `${values.map((value) => JSON.stringify(value)).join('\n')}\n`,
    'utf8',
  );
}

function createDesktopEvent(input: {
  eventId: string;
  eventName: 'desktop.started' | 'electron.permissionDenied';
  timestamp: string;
}): Record<string, unknown> {
  const isPermissionEvent = input.eventName === 'electron.permissionDenied';

  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: isPermissionEvent ? 'security' : 'runtime',
    component: 'desktop',
    eventId: input.eventId,
    eventName: input.eventName,
    level: isPermissionEvent ? 'warn' : 'info',
    outcome: isPermissionEvent ? 'blocked' : 'success',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    ...(isPermissionEvent ? { stage: 'request' } : {}),
    timestamp: input.timestamp,
  };
}

function eventOptions(eventId: string, timestamp: string) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    eventId,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    timestamp,
  };
}

function createDesktopOperationalEventFixture(input: {
  category: string;
  errorCode?: string;
  eventId: string;
  eventName: string;
  level: string;
  outcome: string;
  timestamp: string;
}): Record<string, unknown> {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: input.category,
    component: 'desktop',
    durationMs: 1,
    ...(input.errorCode === undefined
      ? {}
      : { errorCode: input.errorCode }),
    eventId: input.eventId,
    eventName: input.eventName,
    level: input.level,
    outcome: input.outcome,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    sideEffectState: 'none',
    stage: 'shellOpen',
    timestamp: input.timestamp,
  };
}
