import { describe, expect, it, vi } from 'vitest';

import { createProfileBackupOperationalObserver } from './profileBackupOperationalObserver.js';

const identity = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: '123456789abc',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
};

describe('profile backup operational observer', () => {
  it('writes a validated event containing only safe backup metadata', () => {
    const write = vi.fn();
    const observer = createProfileBackupOperationalObserver({
      operationalIdentity: identity,
      operationalLogger: { write },
    });

    observer.observe({
      correlationId: '22222222-2222-4222-8222-222222222222',
      durationMs: 25,
      eventName: 'backup.completed',
      stage: 'portable',
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: '22222222-2222-4222-8222-222222222222',
        durationMs: 25,
        eventName: 'backup.completed',
        stage: 'portable',
      }),
    );
    expect(JSON.stringify(write.mock.calls)).not.toMatch(
      /(?:profileId|companyId|artifactId|manifest|password|path)/i,
    );
  });

  it('does not throw when operational storage fails', () => {
    const observer = createProfileBackupOperationalObserver({
      operationalIdentity: identity,
      operationalLogger: {
        write() {
          throw new Error('SYNTHETIC_LOG_WRITE_FAILURE');
        },
      },
    });

    expect(() =>
      observer.observe({
        correlationId: '22222222-2222-4222-8222-222222222222',
        errorCode: 'PROFILE_BACKUP_CREATE_FAILED',
        eventName: 'backup.failed',
        retryable: true,
        sideEffectState: 'unknown',
        stage: 'portable',
      }),
    ).not.toThrow();
  });
});
