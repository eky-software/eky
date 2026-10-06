import { vi } from 'vitest';

import type { InvoiceLegacyRevisionPromoter } from '../ports/invoiceLegacyRevisionPromoter.js';

export function createUnexpectedLegacyRevisionPromoter() {
  return {
    promoteLegacyRevisionIfCurrent: vi.fn<InvoiceLegacyRevisionPromoter['promoteLegacyRevisionIfCurrent']>()
      .mockRejectedValue(new Error('Unexpected legacy revision promotion.')),
  } satisfies InvoiceLegacyRevisionPromoter;
}
