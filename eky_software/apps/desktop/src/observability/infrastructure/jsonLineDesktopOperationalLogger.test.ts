import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDesktopOperationalEvent } from '../createDesktopOperationalEvent.js';
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
