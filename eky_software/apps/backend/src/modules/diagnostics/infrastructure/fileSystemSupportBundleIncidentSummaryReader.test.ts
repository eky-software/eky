import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemSupportBundleIncidentSummaryReader } from './fileSystemSupportBundleIncidentSummaryReader.js';

const roots: string[] = [];

describe('FileSystemSupportBundleIncidentSummaryReader', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('groups safe incident summaries over a year boundary without source identifiers', async () => {
    const logsRoot = createLogsRoot();
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2025.jsonl',
      [
        incident({
          component: 'backend',
          timestamp: '2025-12-20T10:00:00.000Z',
        }),
      ],
    );
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2026.jsonl',
      [
        incident({
          component: 'backend',
          timestamp: '2026-01-10T10:00:00.000Z',
        }),
      ],
    );
    writeIncidentLines(
      logsRoot,
      'desktop-incident-index-2026.jsonl',
      [
        incident({
          component: 'desktop',
          errorCode: 'DESKTOP_BOOTSTRAP_FAILED',
          eventName: 'desktop.bootstrapFailed',
          fingerprint: 'desktop.bootstrapFailed:DESKTOP_BOOTSTRAP_FAILED',
          timestamp: '2026-01-11T10:00:00.000Z',
        }),
      ],
    );

    const result =
      await new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2025-12-15T12:00:00.000Z',
        latestTimestamp: '2026-01-14T12:00:00.000Z',
      });

    expect(result).toEqual({
      incidentSummaries: [
        expect.objectContaining({
          count: 1,
          eventName: 'desktop.bootstrapFailed',
          firstOccurredAt: '2026-01-11T10:00:00.000Z',
          lastOccurredAt: '2026-01-11T10:00:00.000Z',
        }),
        {
          appVersion: '0.1.0-alpha.1',
          buildRevision: 'abcdef123456',
          count: 2,
          errorCode: 'DATABASE_OPEN_FAILED',
          eventName: 'database.openFailed',
          fingerprint: 'database.openFailed:DATABASE_OPEN_FAILED',
          firstOccurredAt: '2025-12-20T10:00:00.000Z',
          lastOccurredAt: '2026-01-10T10:00:00.000Z',
          outcome: 'failure',
        },
      ],
      sourceTruncated: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('component');
    expect(serialized).not.toContain('runtimeInstanceId');
    expect(serialized).not.toContain('correlationId');
    expect(serialized).not.toContain('operationId');
    expect(serialized).not.toContain('schemaVersion');
  });

  it('reads exact legacy v0 rows without rewriting the public summary shape', async () => {
    const logsRoot = createLogsRoot();
    const { schemaVersion: _schemaVersion, ...legacyEntry } = incident({
      component: 'backend',
      timestamp: '2026-07-27T10:00:00.000Z',
    });
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2026.jsonl',
      [legacyEntry],
    );

    const result =
      await new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result).toEqual({
      incidentSummaries: [
        {
          appVersion: '0.1.0-alpha.1',
          buildRevision: 'abcdef123456',
          count: 1,
          errorCode: 'DATABASE_OPEN_FAILED',
          eventName: 'database.openFailed',
          fingerprint: 'database.openFailed:DATABASE_OPEN_FAILED',
          firstOccurredAt: '2026-07-27T10:00:00.000Z',
          lastOccurredAt: '2026-07-27T10:00:00.000Z',
          outcome: 'failure',
        },
      ],
      sourceTruncated: false,
    });
  });

  it('ignores incidents outside the exact period and unrelated years', async () => {
    const logsRoot = createLogsRoot();
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2026.jsonl',
      [
        incident({
          component: 'backend',
          timestamp: '2026-06-28T11:59:59.999Z',
        }),
        incident({
          component: 'backend',
          errorCode: 'WITHIN_PERIOD',
          fingerprint: 'database.openFailed:WITHIN_PERIOD',
          timestamp: '2026-06-28T12:00:00.000Z',
        }),
      ],
    );
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2025.jsonl',
      [
        incident({
          component: 'backend',
          timestamp: '2025-12-31T10:00:00.000Z',
        }),
      ],
    );

    const result =
      await new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result.incidentSummaries).toEqual([
      expect.objectContaining({ errorCode: 'WITHIN_PERIOD' }),
    ]);
    expect(result.sourceTruncated).toBe(false);
  });

  it('skips malformed or sensitive rows and reports incomplete source', async () => {
    const logsRoot = createLogsRoot();
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2026.jsonl',
      [
        {
          ...incident({
            component: 'backend',
            timestamp: '2026-07-27T10:00:00.000Z',
          }),
          email: 'person@example.test',
        },
        '{"component":"backend"',
      ],
    );

    const result =
      await new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result).toEqual({
      incidentSummaries: [],
      sourceTruncated: true,
    });
    expect(JSON.stringify(result)).not.toContain('person@example.test');
  });

  it('skips unknown versions and malformed versioned rows without exposing source data', async () => {
    const logsRoot = createLogsRoot();
    const valid = incident({
      component: 'backend',
      timestamp: '2026-07-27T10:00:00.000Z',
    });
    const { fingerprint: _fingerprint, ...missingRequiredField } = valid;
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2026.jsonl',
      [
        { ...valid, schemaVersion: 2 },
        missingRequiredField,
        { ...valid, unexpected: 'private-value' },
        { ...valid, component: 'desktop' },
      ],
    );

    const result =
      await new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result).toEqual({
      incidentSummaries: [],
      sourceTruncated: true,
    });
    expect(JSON.stringify(result)).not.toContain('private-value');
  });

  it('reports summary and source byte limits as truncation', async () => {
    const logsRoot = createLogsRoot();
    writeIncidentLines(
      logsRoot,
      'backend-incident-index-2026.jsonl',
      [
        incident({
          component: 'backend',
          errorCode: 'FIRST_FAILURE',
          fingerprint: 'database.openFailed:FIRST_FAILURE',
          timestamp: '2026-07-27T10:00:00.000Z',
        }),
        incident({
          component: 'backend',
          errorCode: 'SECOND_FAILURE',
          fingerprint: 'database.openFailed:SECOND_FAILURE',
          timestamp: '2026-07-27T11:00:00.000Z',
        }),
      ],
    );

    const summaryLimited =
      await new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
        { maximumIncidentSummaries: 1 },
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });
    const sourceLimited =
      await new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
        { maximumSourceBytes: 32 },
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(summaryLimited.incidentSummaries).toHaveLength(1);
    expect(summaryLimited.sourceTruncated).toBe(true);
    expect(sourceLimited.incidentSummaries).toEqual([]);
    expect(sourceLimited.sourceTruncated).toBe(true);
  });

  it('returns an empty complete result when the incident directory is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-support-incidents-'));
    const logsRoot = join(root, 'logs');
    roots.push(root);
    mkdirSync(logsRoot);

    await expect(
      new FileSystemSupportBundleIncidentSummaryReader(
        logsRoot,
      ).readSupportBundleIncidentSummaries({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      }),
    ).resolves.toEqual({
      incidentSummaries: [],
      sourceTruncated: false,
    });
  });
});

function createLogsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-support-incidents-'));
  const logsRoot = join(root, 'logs');
  roots.push(root);
  mkdirSync(join(logsRoot, 'incident-index'), { recursive: true });
  return logsRoot;
}

function writeIncidentLines(
  logsRoot: string,
  fileName: string,
  entries: unknown[],
): void {
  writeFileSync(
    join(logsRoot, 'incident-index', fileName),
    `${entries
      .map((entry) =>
        typeof entry === 'string' ? entry : JSON.stringify(entry),
      )
      .join('\n')}\n`,
    'utf8',
  );
}

function incident(input: {
  component: 'backend' | 'desktop';
  errorCode?: string;
  eventName?: string;
  fingerprint?: string;
  timestamp: string;
}) {
  return {
    schemaVersion: 1,
    appVersion: '0.1.0-alpha.1',
    buildRevision: 'abcdef123456',
    component: input.component,
    errorCode: input.errorCode ?? 'DATABASE_OPEN_FAILED',
    eventName: input.eventName ?? 'database.openFailed',
    fingerprint:
      input.fingerprint ??
      'database.openFailed:DATABASE_OPEN_FAILED',
    outcome: 'failure',
    timestamp: input.timestamp,
  };
}
