import { describe, expect, it } from 'vitest';

import { parseOptionalBoundedPositiveIntegerQuery } from './parseOptionalBoundedPositiveIntegerQuery.js';

describe('parseOptionalBoundedPositiveIntegerQuery', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['1', 1],
    ['50', 50],
  ])('parses %s as %s', (value, expected) => {
    expect(parseOptionalBoundedPositiveIntegerQuery(value, 1, 50)).toBe(
      expected,
    );
  });

  it.each(['0', '-1', '+1', '01', '1.5', '51', '999999999999999999999'])(
    'rejects invalid bounded positive integer %s',
    (value) => {
      expect(parseOptionalBoundedPositiveIntegerQuery(value, 1, 50)).toBeNull();
    },
  );
});
