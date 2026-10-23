import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { createBackendOperationalEvent } from '../../../observability/createOperationalEvent.js';

import { FileSystemOperationalLogDiagnosticSummaryReader } from './fileSystemOperationalLogDiagnosticSummaryReader.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('FileSystemOperationalLogDiagnosticSummaryReader', () => {
  it('returns bounded log metadata without exposing file paths or contents', async () => {
    const root = createRoot();
    writeLog(
      root,
      'backend',
      'backend-warning-error-2026-06-001.jsonl',
      [
        {
          level: 'warn',
          message: 'private-message-must-not-be-returned',
          timestamp: '2026-06-30T20:00:00.000Z',
        },
        {
          level: 'error',
          timestamp: '2026-07-01T08:00:00.000Z',
        },
      ],
    );
    writeLog(root, 'security', 'backend-security-2026-07-001.jsonl', [
      {
        level: 'warn',
        timestamp: '2026-07-02T08:00:00.000Z',
      },
    ]);

    const result =
      await new FileSystemOperationalLogDiagnosticSummaryReader(
        root,
      ).readOperationalLogSummary();

    expect(result).toMatchObject({
      latestErrorAt: '2026-07-01T08:00:00.000Z',
      latestSecurityEventAt: '2026-07-02T08:00:00.000Z',
      latestWarningAt: '2026-07-02T08:00:00.000Z',
      operationalLogNewestMonth: '2026-07',
      operationalLogOldestMonth: '2026-06',
      operationalLogsAvailable: true,
    });
    expect(result.operationalLogTotalBytes).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain('private-message');
  });

  it('distinguishes a verified empty source from unavailability', async () => {
    const result =
      await new FileSystemOperationalLogDiagnosticSummaryReader(
        createRoot(),
      ).readOperationalLogSummary();

    expect(result).toMatchObject({
      operationalLogsAvailable: true,
      operationalLogTotalBytes: 0,
      operationalLogReadState: { status: 'complete', reasons: [] },
    });
  });

  it('selects the newest bounded candidates across all log streams', async () => {
    const root = createRoot();
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

    for (const month of months) {
      for (const segment of ['001', '002', '003', '004']) {
        writeLog(root, 'backend', `backend-info-${month}-${segment}.jsonl`, [
          { level: 'warn', timestamp: `${month}-01T00:00:00.000Z` },
        ]);
        writeLog(
          root,
          'backend',
          `backend-warning-error-${month}-${segment}.jsonl`,
          [{ level: 'warn', timestamp: `${month}-02T00:00:00.000Z` }],
        );
        writeLog(root, 'desktop', `desktop-info-${month}-${segment}.jsonl`, [
          { level: 'warn', timestamp: `${month}-03T00:00:00.000Z` },
        ]);
        writeLog(
          root,
          'desktop',
          `desktop-warning-error-${month}-${segment}.jsonl`,
          [{ level: 'warn', timestamp: `${month}-04T00:00:00.000Z` }],
        );
        writeLog(root, 'security', `backend-security-${month}-${segment}.jsonl`, [
          { level: 'warn', timestamp: `${month}-05T00:00:00.000Z` },
        ]);
        writeLog(root, 'security', `desktop-security-${month}-${segment}.jsonl`, [
          { level: 'warn', timestamp: `${month}-06T00:00:00.000Z` },
        ]);
      }
    }

    writeLog(
      root,
      'backend',
      'backend-warning-error-2026-05-004.jsonl',
      [{ level: 'error', timestamp: '2026-05-30T10:00:00.000Z' }],
    );
    writeLog(
      root,
      'desktop',
      'desktop-warning-error-2026-05-004.jsonl',
      [{ level: 'warn', timestamp: '2026-05-30T11:00:00.000Z' }],
    );
    writeLog(root, 'security', 'desktop-security-2026-05-004.jsonl', [
      { level: 'warn', timestamp: '2026-05-30T12:00:00.000Z' },
    ]);

    const result =
      await new FileSystemOperationalLogDiagnosticSummaryReader(
        root,
      ).readOperationalLogSummary();

    expect(result).toMatchObject({
      latestErrorAt: '2026-05-30T10:00:00.000Z',
      latestSecurityEventAt: '2026-05-30T12:00:00.000Z',
      latestWarningAt: '2026-05-30T12:00:00.000Z',
      operationalLogNewestMonth: '2026-05',
      operationalLogOldestMonth: '2026-02',
      operationalLogReadState: { status: 'partial', reasons: ['limitReached'] },
    });
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-log-summary-'));
  roots.push(root);
  return root;
}

function writeLog(
  root: string,
  directoryName: string,
  fileName: string,
  events: Array<{ level: 'error' | 'warn'; timestamp: string; message?: string }>,
): void {
  const directory = join(root, directoryName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, fileName),
    `${events.map((event, index) => JSON.stringify({
      ...summaryEvent(event.level, event.timestamp, directoryName === 'desktop' || fileName.startsWith('desktop-'), index),
      ...(event.message === undefined ? {} : { message: event.message }),
    })).join('\n')}\n`,
    'utf8',
  );
}

function summaryEvent(level: 'error' | 'warn', timestamp: string, desktop: boolean, index: number) {
  const identity = { appVersion: '1.0.0', buildRevision: 'abcdef123456',
    eventId: `summary-${index}`, runtimeInstanceId: '11111111-1111-4111-8111-111111111111', timestamp };
  if (!desktop) return level === 'error'
    ? createBackendOperationalEvent({ eventName: 'database.openFailed', errorCode: 'DATABASE_OPEN_FAILED' }, identity)
    : createBackendOperationalEvent({ eventName: 'operationalLog.capacityReached', stage: 'write' }, identity);
  return { ...identity, schemaVersion: 1, component: 'desktop',
    category: 'operationalLog', level, outcome: 'failure', stage: 'write',
    eventName: level === 'error' ? 'operationalLog.writeFailed' : 'operationalLog.capacityReached',
    ...(level === 'error' ? { errorCode: 'LOG_WRITE_FAILED' } : {}) };
}
