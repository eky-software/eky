import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopOperationalEvent } from '../createDesktopOperationalEvent.js';
import { validateDesktopOperationalEvent } from '../desktopOperationalEventValidator.js';
import { DesktopIncidentIndexingOperationalLogger } from './jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from './jsonLineDesktopOperationalLogger.js';
import { createWorkspaceBackupOperationalObserver } from '../../workspaces/management/workspaceBackupOperationalObserver.js';

const temporaryDirectories: string[] = [];
const eventOptions = {
  appVersion: '0.0.0',
  buildRevision: '123456789abc',
  eventId: 'desktop-event-1',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-07-26T20:00:00.000Z',
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('JsonLineDesktopOperationalLogger', () => {
  it('keeps resumed deletion primary and cleanup in JSONL but minimizes both incident rows', test => {
    test.onTestFinished(() => { vi.useRealTimers(); });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(eventOptions.timestamp));
    const root = mkdtempSync(join(tmpdir(), 'eky-delete-log-'));
    test.onTestFinished(() => {
      if (test.task.result?.state === 'pass') rmSync(root, { force: true, recursive: true });
    });
    const logsRoot = join(root, 'logs');
    const detailed = new JsonLineDesktopOperationalLogger({ logsRoot });
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: { appVersion: eventOptions.appVersion, buildRevision: eventOptions.buildRevision,
        runtimeInstanceId: eventOptions.runtimeInstanceId },
      operationalLogger: new DesktopIncidentIndexingOperationalLogger(detailed, logsRoot),
    });
    const failure = { correlationId: '22222222-2222-4222-8222-222222222222', durationMs: 2,
      operationKind: 'deleteResume', outcome: 'failed', retryable: false, sideEffectState: 'unknown' } as const;
    observer.record({ ...failure, stage: 'deleteRegistry', errorCode: 'WORKSPACE_DELETE_JOURNAL_CONFLICT' });
    observer.record({ ...failure, stage: 'deleteCleanup', errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED' });
    const files = readdirSync(join(logsRoot, 'desktop'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^desktop-warning-error-\d{4}-\d{2}-001\.jsonl$/u);
    const rows = readFileSync(join(logsRoot, 'desktop', files[0]!), 'utf8')
      .trim().split('\n').map(line => {
        const event = validateDesktopOperationalEvent(JSON.parse(line));
        if (event.eventName !== 'workspaceManagement.operationFailed') throw new Error('Unexpected deletion event.');
        return event;
      });
    expect(rows).toHaveLength(2);
    expect(rows.map(row => [row.stage, row.errorCode])).toEqual([
      ['deleteRegistry', 'WORKSPACE_DELETE_JOURNAL_CONFLICT'],
      ['deleteCleanup', 'WORKSPACE_DELETE_CLEANUP_FAILED'],
    ]);
    expect(rows.every(row => row.correlationId === failure.correlationId && row.operationId === 'workspace.deleteResume')).toBe(true);
    const incidents = readFileSync(join(logsRoot, 'incident-index', `desktop-incident-index-${rows[0]!.timestamp.slice(0, 4)}.jsonl`), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    expect(incidents).toHaveLength(2);
    expect(incidents.map(row => row.errorCode)).toEqual(rows.map(row => row.errorCode));
    for (const incident of incidents) expect(Object.keys(incident).sort()).toEqual([
      'appVersion', 'buildRevision', 'component', 'errorCode', 'eventName',
      'fingerprint', 'outcome', 'schemaVersion', 'timestamp',
    ]);
  });

  it.each([
    ['workspace.create', 'WORKSPACE_CREATION_LABEL_EXISTS'],
    ['workspace.import', 'WORKSPACE_IMPORT_LABEL_EXISTS'],
    ['workspace.create', 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'],
    ['workspace.import', 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'],
    ['workspace.rename', 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'],
  ] as const)('writes only the safe %s label conflict %s', (operationId, errorCode) => {
    const root = mkdtempSync(join(tmpdir(), 'eky-desktop-log-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const detailedLogger = new JsonLineDesktopOperationalLogger({ logsRoot });
    const logger = new DesktopIncidentIndexingOperationalLogger(detailedLogger, logsRoot);
    const event = createDesktopOperationalEvent({
      eventName: 'workspaceManagement.operationFailed', operationId, errorCode,
      correlationId: '22222222-2222-4222-8222-222222222222', durationMs: 2,
      stage: 'operation', retryable: false, sideEffectState: 'unknown',
    }, eventOptions);
    if (event.eventName !== 'workspaceManagement.operationFailed') {
      throw new Error('Unexpected workspace management fixture event.');
    }
    logger.write(event);
    for (const change of [
      { errorCode: 'WORKSPACE_LABEL_EXISTS' }, { errorCode: 'unknown' },
      { operationId: 'workspace.replace' }, { operationId: 'workspace.switch' },
      { stage: 'admission' }, { stage: 'lineageCheck' }, { retryable: true },
      { workspaceLabel: 'Synthetic' }, { workspaceId: 'synthetic-workspace-id' },
      { message: 'synthetic-private' }, { rawError: 'synthetic-private' },
      { companyId: 'synthetic-company' }, { path: '/synthetic/private' },
    ]) expect(() => validateDesktopOperationalEvent({ ...event, ...change })).toThrow();
    detailedLogger.write({ ...event, errorCode: 'WORKSPACE_LABEL_EXISTS' });
    const line = readFileSync(join(logsRoot, 'desktop', 'desktop-warning-error-2026-07-001.jsonl'), 'utf8');
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toEqual(event);
    expect(line).not.toMatch(/workspaceLabel|workspaceId|companyId|synthetic-private|message|stack|path/);
    const incident = JSON.parse(readFileSync(join(logsRoot, 'incident-index', 'desktop-incident-index-2026.jsonl'), 'utf8'));
    expect(incident).toMatchObject({ eventName: event.eventName, errorCode, outcome: 'failure' });
    expect(Object.keys(incident).sort()).toEqual([
      'appVersion', 'buildRevision', 'component', 'errorCode', 'eventName',
      'fingerprint', 'outcome', 'schemaVersion', 'timestamp',
    ]);
  });

  it('writes desktop and security streams separately', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-desktop-log-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const logger = new JsonLineDesktopOperationalLogger({ logsRoot });

    logger.write(
      createDesktopOperationalEvent(
        { eventName: 'desktop.started' },
        eventOptions,
      ),
    );
    logger.write(
      createDesktopOperationalEvent(
        {
          eventName: 'applicationWindow.navigationBlocked',
          stage: 'will-navigate',
        },
        eventOptions,
      ),
    );

    expect(
      readFileSync(
        join(logsRoot, 'desktop', 'desktop-info-2026-07-001.jsonl'),
        'utf8',
      ),
    ).toContain('"desktop.started"');
    expect(
      readFileSync(
        join(logsRoot, 'security', 'desktop-security-2026-07-001.jsonl'),
        'utf8',
      ),
    ).toContain('"applicationWindow.navigationBlocked"');
  });

  it('writes only allowlisted recovery metadata to JSONL', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-recovery-log-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const logger = new JsonLineDesktopOperationalLogger({ logsRoot });

    logger.write(
      createDesktopOperationalEvent(
        {
          correlationId: '22222222-2222-4222-8222-222222222222',
          errorCode: 'PROFILE_RESTORE_VALIDATION_FAILED',
          eventName: 'restore.validationFailed',
          retryable: false,
          sideEffectState: 'unknown',
          stage: 'restoredProfile',
        },
        eventOptions,
      ),
    );

    const line = readFileSync(
      join(
        logsRoot,
        'desktop',
        'desktop-warning-error-2026-07-001.jsonl',
      ),
      'utf8',
    );
    expect(JSON.parse(line)).toMatchObject({
      correlationId: '22222222-2222-4222-8222-222222222222',
      eventName: 'restore.validationFailed',
      stage: 'restoredProfile',
    });
    expect(line).not.toMatch(
      /(?:operationId|profileId|companyId|artifactId|manifest|password|path)/i,
    );
  });

  it('writes a minimized terminal restore event to JSONL', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-terminal-restore-log-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const logger = new JsonLineDesktopOperationalLogger({ logsRoot });

    logger.write(
      createDesktopOperationalEvent(
        {
          correlationId: '22222222-2222-4222-8222-222222222222',
          errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
          eventName: 'restore.recoveryRequired',
          retryable: false,
          sideEffectState: 'unknown',
          stage: 'failedSafeJournal',
        },
        eventOptions,
      ),
    );

    const line = readFileSync(
      join(
        logsRoot,
        'desktop',
        'desktop-warning-error-2026-07-001.jsonl',
      ),
      'utf8',
    );
    expect(JSON.parse(line)).toMatchObject({
      correlationId: '22222222-2222-4222-8222-222222222222',
      eventName: 'restore.recoveryRequired',
      stage: 'failedSafeJournal',
    });
    expect(line).not.toMatch(
      /(?:journalPhase|operationId|profileId|companyId|manifest|password|path)/i,
    );
  });
});
