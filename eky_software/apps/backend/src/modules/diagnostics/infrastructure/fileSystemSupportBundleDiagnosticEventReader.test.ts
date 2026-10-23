import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createBackendOperationalEvent } from '../../../observability/createOperationalEvent.js';
import { projectDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';
import { FileSystemSupportBundleDiagnosticEventReader } from './fileSystemSupportBundleDiagnosticEventReader.js';

const roots: string[] = [];

describe('FileSystemSupportBundleDiagnosticEventReader', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('reads only relevant warning, error and security streams over month and year boundaries', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2025-12-001.jsonl',
      [backendFailure('december-error', '2025-12-20T10:00:00.000Z')],
    );
    writeLines(
      logsRoot,
      'security',
      'desktop-security-2026-01-001.jsonl',
      [desktopSecurity('january-security', '2026-01-10T10:00:00.000Z')],
    );
    writeLines(
      logsRoot,
      'backend',
      'backend-info-2026-01-001.jsonl',
      [
        createBackendOperationalEvent(
          { eventName: 'backend.started' },
          eventOptions('ignored-info', '2026-01-11T10:00:00.000Z'),
        ),
      ],
    );
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2025-11-001.jsonl',
      [backendFailure('outside-period', '2025-11-30T10:00:00.000Z')],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2025-12-15T12:00:00.000Z',
        latestTimestamp: '2026-01-14T12:00:00.000Z',
      });

    expect(result).toEqual({
      diagnosticEvents: [
        expect.objectContaining({
          id: 'desktop:january-security',
        }),
        expect.objectContaining({
          id: 'backend:december-error',
        }),
      ],
      sourceTruncated: false,
    });
  });

  it('includes archive failures but not info payloads even inside a warning stream', async () => {
    const logsRoot = createLogsRoot();
    const identity = eventOptions('synthetic-archive-copy', '2026-07-27T10:00:00.000Z');
    const desktop = { ...identity, category: 'invoicePdfArchive', component: 'desktop', schemaVersion: 1 };
    writeLines(logsRoot, 'desktop', 'desktop-warning-error-2026-07-001.jsonl', [
      { ...desktop, eventName: 'invoicePdfArchive.copyFailed', level: 'warn', outcome: 'failure',
        errorCode: 'ARCHIVE_REQUEST_FAILED', attemptCount: 2, durationMs: 3, retryable: true, sideEffectState: 'none' },
      { ...desktop, eventId: 'archive-copy-success', eventName: 'invoicePdfArchive.copySucceeded',
        level: 'info', outcome: 'success', attemptCount: 2, durationMs: 3 },
      { ...desktop, eventId: 'archive-task', eventName: 'invoicePdfArchive.taskQueued', level: 'info', outcome: 'success' },
      { ...desktop, eventId: 'archive-config', eventName: 'invoicePdfArchive.configurationChanged',
        level: 'info', outcome: 'success', stage: 'enabled' },
    ]);
    const queue = createBackendOperationalEvent({
      eventName: 'invoicePdfArchive.queueFailed', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
      retryable: true, sideEffectState: 'none', stage: 'queue',
    }, eventOptions('archive-queue', '2026-07-27T10:01:00.000Z'));
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-001.jsonl', [queue]);
    const result = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot)
      .readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-07-01T00:00:00.000Z', latestTimestamp: '2026-07-28T00:00:00.000Z',
      });
    expect(result.sourceTruncated).toBe(false);
    expect(result.diagnosticEvents).toEqual([
      expect.objectContaining({ eventName: 'invoicePdfArchive.queueFailed', stage: 'queue' }),
      expect.objectContaining({ eventName: 'invoicePdfArchive.copyFailed', durationMs: 3 }),
    ]);
    expect(JSON.stringify(result)).not.toContain('attemptCount');
  });

  it('prioritizes newest segments and reports event limits as truncation', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2026-07-001.jsonl',
      [backendFailure('older', '2026-07-20T10:00:00.000Z')],
    );
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2026-07-002.jsonl',
      [backendFailure('newer', '2026-07-27T10:00:00.000Z')],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(logsRoot, {
        maximumDiagnosticEvents: 1,
      }).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result.diagnosticEvents).toEqual([
      expect.objectContaining({ id: 'backend:newer' }),
    ]);
    expect(result.sourceTruncated).toBe(true);
  });

  it('selects the newest event across streams before applying the event limit', async () => {
    const logsRoot = createLogsRoot();
    writeLines(logsRoot, 'security', 'desktop-security-2026-07-001.jsonl', [
      desktopSecurity('older-desktop', '2026-07-27T10:00:00.000Z'),
    ]);
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-001.jsonl', [
      backendFailure('newer-backend', '2026-07-27T11:00:00.000Z'),
    ]);

    const result = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot, {
      maximumDiagnosticEvents: 1,
    }).readSupportBundleDiagnosticEvents(julyPeriod);

    expect(result.diagnosticEvents.map(event => event.id)).toEqual(['backend:newer-backend']);
    expect(result.sourceTruncated).toBe(true);
  });

  it('applies the byte budget to the global newest prefix including array bytes', async () => {
    const logsRoot = createLogsRoot();
    const newest = backendFailure('newer-backend', '2026-07-27T11:00:00.000Z');
    writeLines(logsRoot, 'security', 'desktop-security-2026-07-001.jsonl', [
      desktopSecurity('older-desktop', '2026-07-27T10:00:00.000Z'),
    ]);
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-001.jsonl', [newest]);
    const expected = projectDiagnosticOperationalEvent(newest);
    expect(expected).not.toBeNull();
    const budget = Buffer.byteLength(JSON.stringify([expected]), 'utf8');

    const result = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot, {
      maximumProjectedEventBytes: budget,
    }).readSupportBundleDiagnosticEvents(julyPeriod);

    expect(result.diagnosticEvents).toEqual([expected]);
    expect(Buffer.byteLength(JSON.stringify(result.diagnosticEvents), 'utf8')).toBe(budget);
    expect(result.sourceTruncated).toBe(true);
  });

  it('keeps a stable timestamp tie and deduplicates across segments before limiting', async () => {
    const logsRoot = createLogsRoot();
    const timestamp = '2026-07-27T10:00:00.000Z';
    const duplicate = backendFailure('same-backend', timestamp);
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-001.jsonl', [duplicate]);
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-002.jsonl', [duplicate]);
    writeLines(logsRoot, 'security', 'desktop-security-2026-07-001.jsonl', [
      desktopSecurity('same-desktop', timestamp),
    ]);

    const result = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot, {
      maximumDiagnosticEvents: 2,
    }).readSupportBundleDiagnosticEvents(julyPeriod);

    expect(result.diagnosticEvents.map(event => event.id)).toEqual([
      'desktop:same-desktop', 'backend:same-backend',
    ]);
    expect(result.sourceTruncated).toBe(false);
  });

  it('marks conflicting projections of one ID as partial and retains the observed newest', async () => {
    const logsRoot = createLogsRoot();
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-002.jsonl', [
      backendFailure('conflicting-id', '2026-07-27T10:00:00.000Z'),
    ]);
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-001.jsonl', [
      backendFailure('conflicting-id', '2026-07-27T11:00:00.000Z'),
    ]);

    const result = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot)
      .readSupportBundleDiagnosticEvents(julyPeriod);

    expect(result.diagnosticEvents).toEqual([expect.objectContaining({
      id: 'backend:conflicting-id', occurredAt: '2026-07-27T11:00:00.000Z',
    })]);
    expect(result.sourceTruncated).toBe(true);
  });

  it('retains the newest event after multiple bounded candidate batches', async () => {
    const logsRoot = createLogsRoot();
    writeLines(logsRoot, 'backend', 'backend-warning-error-2026-07-001.jsonl',
      Array.from({ length: 9 }, (_, index) => backendFailure(
        `batch-${index}`, `2026-07-27T10:00:0${index}.000Z`,
      )).reverse());

    const result = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot, {
      maximumDiagnosticEvents: 1,
    }).readSupportBundleDiagnosticEvents(julyPeriod);

    expect(result.diagnosticEvents.map(event => event.id)).toEqual(['backend:batch-8']);
    expect(result.sourceTruncated).toBe(true);
  });

  it('does not spend source budget on info streams', async () => {
    const logsRoot = createLogsRoot();
    writeFileSync(
      join(logsRoot, 'backend', 'backend-info-2026-07-001.jsonl'),
      `${'x'.repeat(8_000)}\n`,
      'utf8',
    );
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2026-07-001.jsonl',
      [backendFailure('relevant', '2026-07-27T10:00:00.000Z')],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(logsRoot, {
        maximumSourceBytes: 2_000,
      }).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result.diagnosticEvents).toEqual([
      expect.objectContaining({ id: 'backend:relevant' }),
    ]);
    expect(result.sourceTruncated).toBe(false);
  });

  it('excludes an SMTP success event even if it is misplaced in a warning stream', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2026-07-001.jsonl',
      [
        createBackendOperationalEvent(
          {
            cipherName: 'TLS_AES_256_GCM_SHA384',
            durationMs: 25,
            eventName: 'smtp.connectionSecured',
            operationId: 'smtp-success-operation',
            peerCertificateFingerprint256: Array.from(
              { length: 32 },
              (_, index) =>
                index.toString(16).padStart(2, '0').toUpperCase(),
            ).join(':'),
            remoteAddress: '192.0.2.10',
            remoteFamily: 'IPv4',
            smtpProfile: 'dnaSmtp',
            stage: 'connect',
            targetPort: 465,
            tlsVersion: 'TLSv1.3',
          },
          eventOptions(
            'misplaced-smtp-success',
            '2026-07-27T11:00:00.000Z',
          ),
        ),
        backendFailure('relevant', '2026-07-27T10:00:00.000Z'),
      ],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result.diagnosticEvents).toEqual([
      expect.objectContaining({ id: 'backend:relevant' }),
    ]);
  });

  it('includes only the sanitized recovery failure projection', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'desktop',
      'desktop-warning-error-2026-07-001.jsonl',
      [
        desktopRecoveryFailure(
          'recovery-failure',
          '2026-07-27T10:00:00.000Z',
        ),
      ],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result.diagnosticEvents).toEqual([
      expect.objectContaining({
        correlationId: '22222222-2222-4222-8222-222222222222',
        eventName: 'recoveryPoint.failed',
        recoveryPointKind: 'daily',
        stage: 'creation',
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /(?:operationId|profileId|companyId|artifactId|manifest|path)/i,
    );
  });

  it('includes a portable backup failure but excludes its info-level completion', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'desktop',
      'desktop-info-2026-08-001.jsonl',
      [
        desktopBackupEvent(
          'backup-completed',
          'backup.completed',
          '2026-08-09T10:00:00.000Z',
        ),
      ],
    );
    writeLines(
      logsRoot,
      'desktop',
      'desktop-warning-error-2026-08-001.jsonl',
      [
        desktopBackupEvent(
          'backup-failed',
          'backup.failed',
          '2026-08-09T10:01:00.000Z',
        ),
      ],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-07-10T12:00:00.000Z',
        latestTimestamp: '2026-08-09T12:00:00.000Z',
      });

    expect(result).toEqual({
      diagnosticEvents: [
        expect.objectContaining({
          correlationId: '33333333-3333-4333-8333-333333333333',
          errorCode: 'PROFILE_BACKUP_CREATE_FAILED',
          eventName: 'backup.failed',
          stage: 'portable',
        }),
      ],
      sourceTruncated: false,
    });
    expect(JSON.stringify(result)).not.toContain('backup.completed');
  });

  it('includes only minimized terminal restore failure metadata', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'desktop',
      'desktop-warning-error-2026-08-001.jsonl',
      [
        desktopRestoreRecoveryRequiredEvent(
          'restore-recovery-required',
          '2026-08-09T10:02:00.000Z',
        ),
      ],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-07-10T12:00:00.000Z',
        latestTimestamp: '2026-08-09T12:00:00.000Z',
      });

    expect(result).toEqual({
      diagnosticEvents: [
        expect.objectContaining({
          correlationId: '44444444-4444-4444-8444-444444444444',
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          eventName: 'restore.recoveryRequired',
          stage: 'failedSafeJournal',
        }),
      ],
      sourceTruncated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /(?:journalPhase|operationId|profileId|companyId|manifest|password|path)/i,
    );
  });

  it.each([
    {
      fileName: 'backend-warning-error-2026-07-001.jsonl',
      limits: {},
      lines: ['{"component":"backend"'],
      name: 'malformed relevant source',
    },
    {
      fileName: 'backend-warning-error-2026-07-001.jsonl',
      limits: { maximumSourceBytes: 32 },
      lines: [backendFailure('too-large', '2026-07-27T10:00:00.000Z')],
      name: 'partially read relevant source',
    },
  ])('reports $name as truncated without exposing raw content', async ({
    fileName,
    limits,
    lines,
  }) => {
    const logsRoot = createLogsRoot();
    writeLines(logsRoot, 'backend', fileName, lines);

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
        limits,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result.sourceTruncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain('too-large');
    expect(JSON.stringify(result)).not.toContain('component');
  });

  it('reports file limits and missing segment continuity as truncation', async () => {
    const logsRoot = createLogsRoot();
    writeLines(
      logsRoot,
      'backend',
      'backend-warning-error-2026-07-002.jsonl',
      [backendFailure('second-segment', '2026-07-27T10:00:00.000Z')],
    );
    writeLines(
      logsRoot,
      'security',
      'desktop-security-2026-07-001.jsonl',
      [desktopSecurity('security', '2026-07-26T10:00:00.000Z')],
    );

    const result =
      await new FileSystemSupportBundleDiagnosticEventReader(logsRoot, {
        maximumCandidateFiles: 1,
      }).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      });

    expect(result.sourceTruncated).toBe(true);
    expect(result.diagnosticEvents).toHaveLength(1);
  });

  it('treats absent log directories as an empty complete source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-support-diagnostics-'));
    roots.push(root);
    const logsRoot = join(root, 'logs');
    mkdirSync(logsRoot);

    await expect(
      new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-06-28T12:00:00.000Z',
        latestTimestamp: '2026-07-28T12:00:00.000Z',
      }),
    ).resolves.toEqual({
      diagnosticEvents: [],
      sourceTruncated: false,
    });
  });

  it('rejects invalid diagnostic periods and relative roots', async () => {
    expect(
      () =>
        new FileSystemSupportBundleDiagnosticEventReader(
          'relative/logs',
        ),
    ).toThrow('Support bundle logs root must be absolute.');

    const logsRoot = createLogsRoot();
    await expect(
      new FileSystemSupportBundleDiagnosticEventReader(
        logsRoot,
      ).readSupportBundleDiagnosticEvents({
        earliestTimestamp: '2026-07-28T12:00:00.000Z',
        latestTimestamp: '2026-06-28T12:00:00.000Z',
      }),
    ).rejects.toThrow('Support bundle diagnostic period is invalid.');
  });
});

const julyPeriod = {
  earliestTimestamp: '2026-06-28T12:00:00.000Z',
  latestTimestamp: '2026-07-28T12:00:00.000Z',
};

function createLogsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-support-diagnostics-'));
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
    `${values
      .map((value) =>
        typeof value === 'string' ? value : JSON.stringify(value),
      )
      .join('\n')}\n`,
    'utf8',
  );
}

function backendFailure(eventId: string, timestamp: string) {
  return createBackendOperationalEvent(
    {
      errorCode: 'PDF_FAILED',
      eventName: 'invoicePdf.generationFailed',
      fingerprint: 'invoicePdf.generationFailed:PDF_FAILED',
      retryable: true,
      sideEffectState: 'none',
      stage: 'render',
    },
    eventOptions(eventId, timestamp),
  );
}

function desktopSecurity(eventId: string, timestamp: string) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: 'security',
    component: 'desktop',
    eventId,
    eventName: 'electron.permissionDenied',
    level: 'warn',
    outcome: 'blocked',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    stage: 'request',
    timestamp,
  };
}

function desktopRecoveryFailure(eventId: string, timestamp: string) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: 'recoveryPoint',
    component: 'desktop',
    correlationId: '22222222-2222-4222-8222-222222222222',
    errorCode: 'RECOVERY_POINT_SOURCE_UNHEALTHY',
    eventId,
    eventName: 'recoveryPoint.failed',
    level: 'warn',
    outcome: 'failure',
    recoveryPointKind: 'daily',
    retryable: true,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    sideEffectState: 'unknown',
    stage: 'creation',
    timestamp,
  };
}

function desktopBackupEvent(
  eventId: string,
  eventName: 'backup.completed' | 'backup.failed',
  timestamp: string,
) {
  const failed = eventName === 'backup.failed';

  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: 'backup',
    component: 'desktop',
    correlationId: '33333333-3333-4333-8333-333333333333',
    durationMs: 42,
    ...(failed
      ? {
          errorCode: 'PROFILE_BACKUP_CREATE_FAILED',
          retryable: true,
          sideEffectState: 'unknown',
        }
      : {}),
    eventId,
    eventName,
    level: failed ? 'error' : 'info',
    outcome: failed ? 'failure' : 'success',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    stage: 'portable',
    timestamp,
  };
}

function desktopRestoreRecoveryRequiredEvent(
  eventId: string,
  timestamp: string,
) {
  return {
    appVersion: '1.0.0',
    buildRevision: '123456789abc',
    category: 'restore',
    component: 'desktop',
    correlationId: '44444444-4444-4444-8444-444444444444',
    errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
    eventId,
    eventName: 'restore.recoveryRequired',
    level: 'error',
    outcome: 'failure',
    retryable: false,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    sideEffectState: 'unknown',
    stage: 'failedSafeJournal',
    timestamp,
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
