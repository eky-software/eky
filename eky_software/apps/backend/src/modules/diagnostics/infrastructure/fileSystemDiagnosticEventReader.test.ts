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
            eventId: 'backend-event-1',
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
  eventName: 'electron.permissionDenied';
  timestamp: string;
}): Record<string, unknown> {
  return {
    appVersion: '1.0.0',
    category: 'security',
    component: 'desktop',
    eventId: input.eventId,
    eventName: input.eventName,
    level: 'warn',
    outcome: 'blocked',
    schemaVersion: 1,
    stage: 'request',
    timestamp: input.timestamp,
  };
}

