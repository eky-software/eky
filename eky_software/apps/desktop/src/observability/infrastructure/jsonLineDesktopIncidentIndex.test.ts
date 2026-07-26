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
  it('stores only a minimal anonymous failure projection', () => {
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
          eventId: 'desktop-event-1',
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
    expect(line).toContain('"BACKEND_UNEXPECTED_EXIT"');
    expect(line).not.toContain('eventId');
    expect(line).not.toContain('stage');
  });
});
