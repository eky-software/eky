import { describe, expect, it } from 'vitest';

import { getBusinessCalendarDate } from './getBusinessCalendarDate.js';

describe('getBusinessCalendarDate', () => {
  it('uses the Helsinki business date instead of the computer time zone', () => {
    expect(
      getBusinessCalendarDate(new Date('2026-01-01T22:30:00.000Z')),
    ).toBe('2026-01-02');
    expect(
      getBusinessCalendarDate(new Date('2026-06-01T21:30:00.000Z')),
    ).toBe('2026-06-02');
  });

  it('rejects invalid dates', () => {
    expect(() => getBusinessCalendarDate(new Date('invalid'))).toThrow(
      RangeError,
    );
  });
});
