import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackendOperationalEvent } from '../createOperationalEvent.js';
import { JsonLineOperationalLogger } from './jsonLineOperationalLogger.js';

const temporaryDirectories: string[] = [];
const eventOptions = {
  appVersion: '0.0.0',
  buildRevision: '123456789abc',
  eventId: 'event-1',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-07-26T20:00:00.000Z',
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('JsonLineOperationalLogger', () => {
  it('writes validated events to a monthly JSONL stream', () => {
    const logsRoot = createLogsRoot();
    const logger = new JsonLineOperationalLogger({ logsRoot });

    logger.write(
      createBackendOperationalEvent(
        {
          errorCode: 'DATABASE_OPEN_FAILED',
          eventName: 'database.openFailed',
          sideEffectState: 'none',
          stage: 'open',
        },
        eventOptions,
      ),
    );

    expect(
      JSON.parse(
        readFileSync(
          join(
            logsRoot,
            'backend',
            'backend-warning-error-2026-07-001.jsonl',
          ),
          'utf8',
        ).trim(),
      ),
    ).toMatchObject({
      errorCode: 'DATABASE_OPEN_FAILED',
      eventName: 'database.openFailed',
    });
  });

  it('routes security events to their own directory', () => {
    const logsRoot = createLogsRoot();
    const logger = new JsonLineOperationalLogger({ logsRoot });

    logger.write(
      createBackendOperationalEvent(
        {
          correlationId: '00000000-0000-4000-8000-000000000001',
          eventName: 'runtimeSession.invalid',
        },
        eventOptions,
      ),
    );

    expect(
      readFileSync(
        join(logsRoot, 'security', 'backend-security-2026-07-001.jsonl'),
        'utf8',
      ),
    ).toContain('"runtimeSession.invalid"');
  });

  it('does not throw when the writer or failure sink fails', () => {
    const failureSink = {
      recordFailure: vi.fn(() => {
        throw new Error('synthetic failure sink error');
      }),
    };
    const logger = new JsonLineOperationalLogger({
      failureSink,
      logsRoot: 'not-an-absolute-path',
    });

    expect(() =>
      logger.write(
        createBackendOperationalEvent(
          { eventName: 'backend.starting' },
          eventOptions,
        ),
      ),
    ).not.toThrow();
    expect(failureSink.recordFailure).toHaveBeenCalledWith({
      errorCode: 'LOG_WRITE_FAILED',
      stream: 'backend-info',
    });
  });
});

function createLogsRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'eky-observability-'));
  temporaryDirectories.push(directory);
  return join(directory, 'logs');
}
