import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

  it('returns the normal unavailable state when no allowlisted logs exist', async () => {
    const result =
      await new FileSystemOperationalLogDiagnosticSummaryReader(
        createRoot(),
      ).readOperationalLogSummary();

    expect(result).toMatchObject({
      operationalLogsAvailable: false,
      operationalLogTotalBytes: 0,
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
  events: unknown[],
): void {
  const directory = join(root, directoryName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, fileName),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
}
