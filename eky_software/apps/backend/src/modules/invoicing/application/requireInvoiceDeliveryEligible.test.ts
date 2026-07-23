import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';

describe('requireInvoiceDeliveryEligible', () => {
  it.each(['approved', 'sent'] as const)(
    'allows a %s invoice',
    (status) => {
      expect(() =>
        requireInvoiceDeliveryEligible({ status } as ApprovedInvoiceView),
      ).not.toThrow();
    },
  );

  it('hides a cancelled invoice behind the generic not-found boundary', () => {
    expect(() =>
      requireInvoiceDeliveryEligible({
        status: 'cancelled',
      } as ApprovedInvoiceView),
    ).toThrow(ApprovedInvoiceNotFoundError);
  });
});
