import { describe, expect, it } from 'vitest';

import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { updateOperationalStages } from '../observability/desktopOperationalEvent.js';
import { createUpdateOperationalObserver } from './updateOperationalObserver.js';

const identity = {
  appVersion: '0.2.0',
  buildRevision: 'bbbbbbbbbbbb',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
};
const correlationId = '22222222-2222-4222-8222-222222222222';

describe('update operational observer', () => {
  it('writes only catalogued lifecycle metadata', () => {
    const events: DesktopOperationalEvent[] = [];
    const observer = createUpdateOperationalObserver({
      identity,
      logger: { write: (event) => events.push(event) },
    });

    observer.operationStarted({
      correlationId,
      stage: 'firstStartValidation',
    });
    observer.operationCompleted({
      correlationId,
      durationMs: 20,
      stage: 'firstStartValidation',
    });
    observer.operationStateChanged?.({
      correlationId,
      stage: 'firstStartValidation',
      state: 'accepted',
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      correlationId,
      eventName: 'update.firstStartValidationStarted',
      stage: 'firstStartValidation',
    });
    expect(events[1]).toMatchObject({
      correlationId,
      durationMs: 20,
      eventName: 'update.firstStartValidationSucceeded',
      stage: 'firstStartValidation',
    });
    expect(events[2]).toMatchObject({
      correlationId,
      eventName: 'update.accepted',
      stage: 'firstStartValidation',
    });
    expect(JSON.stringify(events)).not.toMatch(
      /packageSha|profileId|runtimeSession|\\\\Users\\\\|\.msi/i,
    );
  });

  it('maps every closed update stage to its named lifecycle family', () => {
    const events: DesktopOperationalEvent[] = [];
    const observer = createUpdateOperationalObserver({
      identity,
      logger: { write: (event) => events.push(event) },
    });

    for (const stage of updateOperationalStages) {
      observer.operationStarted({ correlationId, stage });
      observer.operationCompleted({ correlationId, durationMs: 1, stage });
      observer.operationFailed({
        correlationId,
        durationMs: 2,
        errorCode: 'UPDATE_OPERATION_FAILED',
        retryable: false,
        sideEffectState: 'unknown',
        stage,
      });
    }

    expect(events).toHaveLength(updateOperationalStages.length * 3);
    for (const stage of updateOperationalStages) {
      expect(events.map((event) => event.eventName)).toEqual(
        expect.arrayContaining([
          `update.${stage}Started`,
          `update.${stage}Succeeded`,
          `update.${stage}Failed`,
        ]),
      );
    }
    expect(JSON.stringify(events)).not.toMatch(
      /companyId|invoiceId|manifest|packageSha256|profileId|runtimeSession|stack|\\\\Users\\\\/i,
    );
  });

  it('does not let a logger failure escape into update orchestration', () => {
    const observer = createUpdateOperationalObserver({
      identity,
      logger: { write: () => { throw new Error('logger unavailable'); } },
    });

    expect(() =>
      observer.operationStarted({
        correlationId,
        stage: 'packageInspection',
      }),
    ).not.toThrow();
  });
});
