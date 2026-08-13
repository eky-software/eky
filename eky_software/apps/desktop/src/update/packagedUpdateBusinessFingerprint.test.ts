import { describe, expect, it } from 'vitest';

import { createPackagedUpdateBusinessDataSha256 } from './packagedUpdateBusinessFingerprint.js';

describe('packaged update business fingerprint', () => {
  it('is stable across object key order without changing array order', () => {
    const first = createPackagedUpdateBusinessDataSha256({
      customer: { id: 'customer-1', name: 'Testi Oy' },
      lines: [{ description: 'Työ', quantityHundredths: 100 }],
    });
    const reordered = createPackagedUpdateBusinessDataSha256({
      lines: [{ quantityHundredths: 100, description: 'Työ' }],
      customer: { name: 'Testi Oy', id: 'customer-1' },
    });

    expect(reordered).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when business data changes', () => {
    const first = createPackagedUpdateBusinessDataSha256({ totalCents: 100 });
    const changed = createPackagedUpdateBusinessDataSha256({ totalCents: 101 });

    expect(changed).not.toBe(first);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, () => undefined])(
    'rejects a non-JSON value: %s',
    (value) => {
      expect(() => createPackagedUpdateBusinessDataSha256(value)).toThrow(
        'DESKTOP_UPDATE_SMOKE_BUSINESS_DATA_INVALID',
      );
    },
  );
});
