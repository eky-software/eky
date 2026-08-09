import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { RecoveryPointScheduler } from './recoveryPointScheduler.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recovery point scheduler', () => {
  it('detects the previous shutdown and runs bounded periodic checks', async () => {
    const checkAutomatic = vi.fn(async () => undefined);
    const scheduler = new RecoveryPointScheduler({
      checkIntervalMilliseconds: 1_000,
      cleanShutdownMarker: {
        consume: vi.fn(async () => 'unclean' as const),
        markClean: vi.fn(async () => undefined),
      },
      recoveryPointService: { checkAutomatic },
    });

    await expect(scheduler.start()).resolves.toBe('unclean');
    expect(checkAutomatic).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(checkAutomatic).toHaveBeenCalledTimes(4);
    await scheduler.stopChecks();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkAutomatic).toHaveBeenCalledTimes(4);
  });

  it('waits for an active check before controlled shutdown continues', async () => {
    let finishCheck: (() => void) | undefined;
    const checkAutomatic = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          finishCheck = () => resolve(undefined);
        }),
    );
    const scheduler = new RecoveryPointScheduler({
      checkIntervalMilliseconds: 1_000,
      cleanShutdownMarker: {
        consume: vi.fn(async () => 'clean' as const),
        markClean: vi.fn(async () => undefined),
      },
      recoveryPointService: { checkAutomatic },
    });
    const starting = scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    const stopping = scheduler.stopChecks();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finishCheck?.();
    await starting;
    await stopping;
    expect(stopped).toBe(true);
  });

  it('writes the clean marker only through controlled shutdown', async () => {
    const markClean = vi.fn(async () => undefined);
    const scheduler = new RecoveryPointScheduler({
      checkIntervalMilliseconds: 1_000,
      cleanShutdownMarker: {
        consume: vi.fn(async () => 'clean' as const),
        markClean,
      },
      now: () => new Date('2026-08-04T12:00:00.000Z'),
      recoveryPointService: {
        checkAutomatic: vi.fn(async () => undefined),
      },
    });
    await scheduler.start();

    await scheduler.markCleanShutdown();

    expect(markClean).toHaveBeenCalledWith(
      '2026-08-04T12:00:00.000Z',
    );
  });

  it('reports one safe automatic check failure and remains best effort', async () => {
    const events: ProfileRecoveryOperationalEvent[] = [];
    const scheduler = new RecoveryPointScheduler({
      checkIntervalMilliseconds: 1_000,
      cleanShutdownMarker: {
        consume: vi.fn(async () => 'clean' as const),
        markClean: vi.fn(async () => undefined),
      },
      correlationIdFactory: () =>
        '22222222-2222-4222-8222-222222222222',
      observer: { observe: (event) => events.push(event) },
      recoveryPointService: {
        checkAutomatic: vi.fn(async () => {
          throw Object.assign(new Error('safe'), {
            code: 'RECOVERY_POINT_SOURCE_UNHEALTHY',
          });
        }),
      },
    });

    await expect(scheduler.start()).resolves.toBe('clean');
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: '22222222-2222-4222-8222-222222222222',
        errorCode: 'RECOVERY_POINT_SOURCE_UNHEALTHY',
        eventName: 'recoveryPoint.failed',
        stage: 'automaticCheck',
      }),
    ]);
  });

  it('does not fail an automatic check when its observer throws', async () => {
    const scheduler = new RecoveryPointScheduler({
      checkIntervalMilliseconds: 1_000,
      cleanShutdownMarker: {
        consume: vi.fn(async () => 'clean' as const),
        markClean: vi.fn(async () => undefined),
      },
      observer: {
        observe() {
          throw new Error('SYNTHETIC_OBSERVER_FAILURE');
        },
      },
      recoveryPointService: {
        checkAutomatic: vi.fn(async () => {
          throw new Error('RECOVERY_POINT_AUTOMATIC_CHECK_FAILED');
        }),
      },
    });

    await expect(scheduler.start()).resolves.toBe('clean');
  });
});
