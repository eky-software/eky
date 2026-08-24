import { describe, expect, it } from 'vitest';

import { readW6b2BusinessAmounts } from './w6b2PackagedWorkspaceBusinessFixture.js';

describe('W6B.2 packaged workspace fixture amounts', () => {
  it('keeps each workspace distinct and all invoice totals coherent', () => {
    const fixtures = ['A', 'B', 'C'] as const;
    const amounts = fixtures.map(readW6b2BusinessAmounts);

    expect(new Set(amounts.map((value) => value.netCents)).size).toBe(3);
    for (const value of amounts) {
      expect(value.netCents + value.vatCents).toBe(value.grossCents);
      expect(value.vatCents).toBe(
        Math.round((value.netCents * 2_550) / 10_000),
      );
    }
  });
});
