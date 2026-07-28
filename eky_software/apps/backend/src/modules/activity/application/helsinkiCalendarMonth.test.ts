import { describe, expect, it } from 'vitest';

import {
  activityBusinessTimeZone,
  formatHelsinkiCalendarMonth,
  getHelsinkiCalendarMonthUtcRange,
  isActivityCalendarMonth,
} from './helsinkiCalendarMonth.js';

describe('Helsinki activity calendar month', () => {
  it('uses the documented business time zone', () => {
    expect(activityBusinessTimeZone).toBe('Europe/Helsinki');
  });

  it.each([
    [
      'winter',
      '2026-01',
      '2025-12-31T22:00:00.000Z',
      '2026-01-31T22:00:00.000Z',
    ],
    [
      'summer',
      '2026-07',
      '2026-06-30T21:00:00.000Z',
      '2026-07-31T21:00:00.000Z',
    ],
    [
      'daylight saving starts',
      '2026-03',
      '2026-02-28T22:00:00.000Z',
      '2026-03-31T21:00:00.000Z',
    ],
    [
      'daylight saving ends',
      '2026-10',
      '2026-09-30T21:00:00.000Z',
      '2026-10-31T22:00:00.000Z',
    ],
    [
      'leap year February',
      '2024-02',
      '2024-01-31T22:00:00.000Z',
      '2024-02-29T22:00:00.000Z',
    ],
  ])('resolves %s boundaries to UTC', (_name, month, from, to) => {
    expect(getHelsinkiCalendarMonthUtcRange(month)).toEqual({ from, to });
  });

  it('assigns a late July UTC instant to Helsinki August', () => {
    expect(
      formatHelsinkiCalendarMonth(new Date('2026-07-31T21:30:00.000Z')),
    ).toBe('2026-08');
  });

  it.each(['', '1999-12', '2026-00', '2026-13', '2026-1', 'not-a-month'])(
    'rejects invalid month %s',
    (month) => {
      expect(isActivityCalendarMonth(month)).toBe(false);
      expect(() => getHelsinkiCalendarMonthUtcRange(month)).toThrow(RangeError);
    },
  );

  it('rejects an invalid date', () => {
    expect(() => formatHelsinkiCalendarMonth(new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
