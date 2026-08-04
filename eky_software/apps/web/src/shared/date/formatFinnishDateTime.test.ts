import { describe, expect, it } from 'vitest';

import { formatFinnishDateTime } from './formatFinnishDateTime.js';

describe('formatFinnishDateTime', () => {
  it('formats timestamps in the Helsinki business time zone', () => {
    expect(formatFinnishDateTime('2026-01-01T22:30:00.000Z')).toMatch(
      /^2\.1\.2026 klo 0\.30$/,
    );
  });

  it('returns null for invalid timestamps', () => {
    expect(formatFinnishDateTime('invalid')).toBeNull();
  });
});
