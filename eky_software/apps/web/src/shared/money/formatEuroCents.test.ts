import { describe, expect, it } from 'vitest';

import { formatEuroCents } from './formatEuroCents.js';

describe('formatEuroCents', () => {
  it('formats positive, zero and negative cents as Finnish euro amounts', () => {
    expect(formatEuroCents(12_345)).toBe('123,45\u00a0€');
    expect(formatEuroCents(0)).toBe('0,00\u00a0€');
    expect(formatEuroCents(-12_345)).toMatch(/−?-\s?123,45|−123,45/);
  });
});
