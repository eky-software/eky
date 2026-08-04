import { describe, expect, it } from 'vitest';

import { formatFinnishCalendarDate } from './formatFinnishCalendarDate.js';

describe('formatFinnishCalendarDate', () => {
  it('formats an ISO calendar date without applying a time zone', () => {
    expect(formatFinnishCalendarDate('2026-08-04')).toBe('04.08.2026');
  });

  it('does not reinterpret timestamps or unknown values', () => {
    expect(formatFinnishCalendarDate('2026-08-04T12:00:00.000Z')).toBeNull();
    expect(formatFinnishCalendarDate('unknown')).toBeNull();
  });
});
