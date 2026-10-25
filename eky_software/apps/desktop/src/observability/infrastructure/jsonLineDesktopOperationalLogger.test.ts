import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDesktopOperationalEvent } from '../createDesktopOperationalEvent.js';
import { validateDesktopOperationalEvent } from '../desktopOperationalEventValidator.js';
import { DesktopIncidentIndexingOperationalLogger } from './jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from './jsonLineDesktopOperationalLogger.js';

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
