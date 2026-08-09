import { describe, expect, it, vi } from 'vitest';

import { createProfileRecoveryOperationalObserver } from './profileRecoveryOperationalObserver.js';

const identity = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: '123456789abc',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
};

describe('profile recovery operational observer', () => {
  it('writes a validated recovery event without business metadata', () => {
    const write = vi.fn();
    const observer = createProfileRecoveryOperationalObserver({
      operationalIdentity: identity,
      operationalLogger: { write },
    });

    observer.observe({
      correlationId: '22222222-2222-4222-8222-222222222222',
      eventName: 'restore.activationStarted',
      stage: 'activation',
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: '22222222-2222-4222-8222-222222222222',
        eventName: 'restore.activationStarted',
        stage: 'activation',
      }),
    );
    expect(JSON.stringify(write.mock.calls)).not.toMatch(
      /(?:profileId|companyId|artifactId|manifest|password|path)/i,
    );
  });

  it('does not throw when operational storage fails', () => {
    const observer = createProfileRecoveryOperationalObserver({
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
        eventName: 'restore.activationStarted',
        stage: 'activation',
      }),
    ).not.toThrow();
  });
});
