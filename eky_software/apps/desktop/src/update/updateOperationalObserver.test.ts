import { describe, expect, it } from 'vitest';

import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
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

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      correlationId,
      eventName: 'update.operationStarted',
      stage: 'firstStartValidation',
    });
    expect(JSON.stringify(events)).not.toMatch(
      /packageSha|profileId|runtimeSession|\\\\Users\\\\|\.msi/i,
    );
  });
});
