import { expect, test } from '@playwright/test';

import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import {
  E2E_ENDURANCE_TIMEOUT_MILLISECONDS,
  ELECTRON_E2E_ENDURANCE_TIMEOUT_MILLISECONDS,
  ELECTRON_E2E_SOAK_RESERVE_MILLISECONDS,
  readDesktopSoakDurationMilliseconds,
} from '../../src/stress/e2eEnduranceBudgets.js';

test.describe('E2E fixture owner-containment lifetime', () => {
  test('shares one origin across setup, siblings and restarts', () => {
    let now = 1_000;
    const lifetime = createE2eFixtureLifetime(60_000, () => now);
    now += 4_000;
    expect(lifetime.readRemainingWorkMilliseconds()).toBe(56_000);
    now += 25_000;
    expect(lifetime.readRemainingWorkMilliseconds()).toBe(31_000);
    const sibling = lifetime;
    now += 10_000;
    expect(sibling.readRemainingWorkMilliseconds()).toBe(21_000);
    expect(lifetime.readRemainingWorkMilliseconds()).toBe(21_000);
    expect(Object.isFrozen(lifetime)).toBe(true);
  });

  test('rounds down the transferable budget and never refreshes an expired one', () => {
    let now = 0;
    const lifetime = createE2eFixtureLifetime(60_000, () => now);
    now = 59_998.25;
    expect(lifetime.readRemainingWorkMilliseconds()).toBe(1);
    now = 60_000;
    expect(lifetime.readRemainingWorkMilliseconds()).toBe(0);
    now = 90_000;
    expect(lifetime.readRemainingWorkMilliseconds()).toBe(0);
  });

  for (const timeout of [150_000, 15 * 60_000, 20 * 60_000, 40 * 60_000]) {
    test(`accepts the existing configured ${timeout}ms ceiling without changing it`, () => {
      let now = 20;
      const lifetime = createE2eFixtureLifetime(timeout, () => now);
      expect(lifetime.readRemainingWorkMilliseconds()).toBe(timeout);
      now += 45_000;
      expect(lifetime.readRemainingWorkMilliseconds()).toBe(timeout - 45_000);
    });
  }

  for (const timeout of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    test(`rejects an unbounded or unrepresentable ${String(timeout)}ms ceiling`, () => {
      expect(() => createE2eFixtureLifetime(timeout)).toThrow('E2E_FIXTURE_LIFETIME_INPUT_INVALID');
    });
  }

  test('latches clock regression instead of adding time', () => {
    let now = 100;
    const lifetime = createE2eFixtureLifetime(60_000, () => now);
    now = 200;
    expect(lifetime.readRemainingWorkMilliseconds()).toBe(59_900);
    now = 199;
    expect(() => lifetime.readRemainingWorkMilliseconds()).toThrow('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
    now = 300;
    expect(() => lifetime.readRemainingWorkMilliseconds()).toThrow('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
  });

  test('does not leak a clock error or recover silently after it', () => {
    let fail = false;
    const lifetime = createE2eFixtureLifetime(60_000, () => {
      if (fail) throw new Error('private clock detail');
      return 100;
    });
    fail = true;
    expect(() => lifetime.readRemainingWorkMilliseconds()).toThrow('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
    fail = false;
    expect(() => lifetime.readRemainingWorkMilliseconds()).toThrow('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
  });

  test('keeps a failing initial clock private', () => {
    expect(() => createE2eFixtureLifetime(60_000, () => {
      throw new Error('private clock detail');
    })).toThrow('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
  });

  for (const invalid of [NaN, Infinity, -1]) {
    test(`rejects an invalid initial clock ${String(invalid)}`, () => {
      expect(() => createE2eFixtureLifetime(60_000, () => invalid))
        .toThrow('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
    });
  }
});

test.describe('E2E declared endurance containment ceilings', () => {
  test('keeps the existing system and desktop endurance durations', () => {
    expect(E2E_ENDURANCE_TIMEOUT_MILLISECONDS).toBe(15 * 60_000);
    expect(ELECTRON_E2E_ENDURANCE_TIMEOUT_MILLISECONDS).toBe(20 * 60_000);
    expect(ELECTRON_E2E_SOAK_RESERVE_MILLISECONDS).toBe(5 * 60_000);
  });

  for (const [input, minutes] of [[undefined, 30], ['1', 1], ['30', 30], ['240', 240]] as const) {
    test(`shares the validated ${String(input)} soak duration without using a global timeout`, () => {
      const duration = readDesktopSoakDurationMilliseconds(input);
      const timeout = duration + ELECTRON_E2E_SOAK_RESERVE_MILLISECONDS;
      const lifetime = createE2eFixtureLifetime(timeout, () => 0);
      expect(duration).toBe(minutes * 60_000);
      expect(lifetime.readRemainingWorkMilliseconds()).toBe((minutes + 5) * 60_000);
    });
  }

  for (const input of ['', '0', '-1', '1.5', '241', 'NaN', 'Infinity', 'private invalid value']) {
    test(`rejects invalid soak input ${JSON.stringify(input)} before launch`, () => {
      expect(() => readDesktopSoakDurationMilliseconds(input))
        .toThrow('Desktop soak duration must be 1-240 whole minutes.');
    });
  }
});
