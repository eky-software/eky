import { describe, expect, it } from 'vitest';

import {
  activityBusinessTimeZone,
  getHelsinkiActivityMonth,
} from './activityCalendarMonth.js';

describe('getHelsinkiActivityMonth', () => {
  it('uses the documented business time zone', () => {
    expect(activityBusinessTimeZone).toBe('Europe/Helsinki');
  });

  it('matches the backend month at the UTC-to-Helsinki month boundary', () => {
    expect(
      getHelsinkiActivityMonth(new Date('2026-07-31T20:59:59.999Z')),
    ).toBe('2026-07');
    expect(
      getHelsinkiActivityMonth(new Date('2026-07-31T21:00:00.000Z')),
    ).toBe('2026-08');
  });

  it('handles winter and leap-year dates', () => {
    expect(
      getHelsinkiActivityMonth(new Date('2023-12-31T22:00:00.000Z')),
    ).toBe('2024-01');
    expect(
      getHelsinkiActivityMonth(new Date('2024-02-29T21:59:59.999Z')),
    ).toBe('2024-02');
  });

  it('rejects an invalid date', () => {
    expect(() => getHelsinkiActivityMonth(new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
