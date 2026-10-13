import { describe, expect, it, vi } from 'vitest';

import { observeMigrationStartupStep } from './migrationStartupObservation.js';

describe('optional migration startup observation', () => {
  it('preserves the value and records only the closed phase pair around the work', () => {
    const order: string[] = [];
    const observer = vi.fn((stage, phase) => { order.push(`${stage}.${phase}`); });
    const value = {};
    expect(observeMigrationStartupStep(observer, 'manifestRead', () => {
      order.push('work');
      return value;
    })).toBe(value);
    expect(order).toEqual(['manifestRead.entered', 'work', 'manifestRead.returned']);
    expect(observer.mock.calls).toEqual([['manifestRead', 'entered'], ['manifestRead', 'returned']]);
  });

  it.each([false, true])('preserves success and the original exception with throwing observer=%s', throws => {
    const observer = throws ? vi.fn(() => { throw new Error('observer'); }) : undefined;
    const original = new Error('original');
    const work = vi.fn(() => 42);
    expect(observeMigrationStartupStep(observer, 'initialAttestation', work)).toBe(42);
    expect(work).toHaveBeenCalledOnce();
    expect(() => observeMigrationStartupStep(observer, 'initialAttestation', () => { throw original; }))
      .toThrow(original);
    if (observer) expect(observer).toHaveBeenCalledTimes(3);
  });

  it('does not claim a returned phase after interrupted work', () => {
    const observer = vi.fn();
    const original = new Error('work stopped');
    let actual: unknown;
    try {
      observeMigrationStartupStep(observer, 'historyPreparation', () => { throw original; });
    } catch (error) { actual = error; }
    expect(actual).toBe(original);
    expect(observer.mock.calls).toEqual([['historyPreparation', 'entered']]);
  });
});
