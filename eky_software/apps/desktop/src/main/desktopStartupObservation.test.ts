import { describe, expect, it, vi } from 'vitest';

import { desktopStartupStagePhases, emitDesktopStartupObservation, isDesktopStartupStage,
  type DesktopStartupSignal } from './desktopStartupObservation.js';

describe('desktop startup observation protocol', () => {
  it('recognizes only own stage names without coercing unknown values', () => {
    expect(Object.isFrozen(desktopStartupStagePhases)).toBe(true);
    expect(Object.keys(desktopStartupStagePhases)).toHaveLength(25);
    for (const stage of Object.keys(desktopStartupStagePhases)) expect(isDesktopStartupStage(stage)).toBe(true);
    for (const value of [undefined, null, 0, {}, [], 'constructor', '__proto__', 'toString', 'pending', ' snapshotReady']) {
      expect(isDesktopStartupStage(value)).toBe(false);
    }
  });

  it('emits immutable exact signals synchronously with the owning phase', () => {
    const signals: DesktopStartupSignal[] = [];
    for (const stage of Object.keys(desktopStartupStagePhases)) {
      if (!isDesktopStartupStage(stage)) throw new Error('INVALID_TEST_STAGE');
      for (const event of ['entered', 'returned'] as const) {
        emitDesktopStartupObservation(signal => signals.push(signal), stage, event);
        const signal = signals.at(-1)!;
        expect(signal).toEqual({ stage, phase: desktopStartupStagePhases[stage], event });
        expect(Object.isFrozen(signal)).toBe(true);
      }
    }
    expect(signals).toHaveLength(50);
    expect(signals[0]).toEqual({ stage: 'snapshotReady', phase: 'work', event: 'entered' });
  });

  it.for([new Error('synthetic observer failure'), undefined])('isolates observer failure %#', failure => {
    const observer = vi.fn(() => { throw failure; });
    expect(() => emitDesktopStartupObservation(observer, 'startupCatch', 'entered')).not.toThrow();
    expect(observer).toHaveBeenCalledExactlyOnceWith({ stage: 'startupCatch', phase: 'failure', event: 'entered' });
  });

  it('allows observation to remain absent', () => {
    expect(() => emitDesktopStartupObservation(undefined, 'backendStop', 'returned')).not.toThrow();
  });
});
