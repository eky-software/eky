import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDesktopOperationalEvent } from '../createDesktopOperationalEvent.js';
import { JsonLineDesktopOperationalLogger } from './jsonLineDesktopOperationalLogger.js';
import { DesktopIncidentIndexingOperationalLogger } from './jsonLineDesktopIncidentIndex.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('DesktopIncidentIndexingOperationalLogger', () => {
  it('stores only a versioned minimal failure projection without direct identifiers', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-desktop-incident-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const logger = new DesktopIncidentIndexingOperationalLogger(
      new JsonLineDesktopOperationalLogger({ logsRoot }),
      logsRoot,
    );

    logger.write(
      createDesktopOperationalEvent(
        {
          errorCode: 'BACKEND_UNEXPECTED_EXIT',
          eventName: 'backendProcess.unexpectedExit',
          sideEffectState: 'unknown',
          stage: 'runtime',
        },
        {
          appVersion: '0.0.0',
          buildRevision: '123456789abc',
          eventId: 'desktop-event-1',
          runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
          timestamp: '2026-07-26T20:00:00.000Z',
        },
      ),
    );

    const line = readFileSync(
      join(
        logsRoot,
        'incident-index',
        'desktop-incident-index-2026.jsonl',
      ),
      'utf8',
    );
    expect(JSON.parse(line)).toMatchObject({
      schemaVersion: 1,
      appVersion: '0.0.0',
      buildRevision: '123456789abc',
      component: 'desktop',
      errorCode: 'BACKEND_UNEXPECTED_EXIT',
    });
    expect(line).not.toContain('eventId');
    expect(line).not.toContain('runtimeInstanceId');
    expect(line).not.toContain('stage');
  });

  it('does not copy recovery correlation identifiers into the incident index', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-recovery-incident-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const logger = new DesktopIncidentIndexingOperationalLogger(
      new JsonLineDesktopOperationalLogger({ logsRoot }),
      logsRoot,
    );

    logger.write(
      createDesktopOperationalEvent(
        {
          correlationId: '22222222-2222-4222-8222-222222222222',
          errorCode: 'PROFILE_RESTORE_VALIDATION_FAILED',
          eventName: 'restore.validationFailed',
          sideEffectState: 'unknown',
          stage: 'restoredProfile',
        },
        {
          appVersion: '0.0.0',
          buildRevision: '123456789abc',
          eventId: 'desktop-event-2',
          runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
          timestamp: '2026-07-26T20:00:00.000Z',
        },
      ),
    );

    const line = readFileSync(
      join(
        logsRoot,
        'incident-index',
        'desktop-incident-index-2026.jsonl',
      ),
      'utf8',
    );
    expect(line).toContain('restore.validationFailed');
    expect(line).not.toMatch(
      /(?:correlationId|operationId|entityId|runtimeInstanceId)/,
    );
  });
});
