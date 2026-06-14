import { describe, expect, it } from 'vitest';

import { reduceInvoicingPageMode } from './invoicingPageState.js';

describe('reduceInvoicingPageMode', () => {
  it('opens the new invoice form from the draft list', () => {
    expect(
      reduceInvoicingPageMode('draftList', { type: 'openNewInvoice' }),
    ).toBe('newInvoice');
  });

  it('returns from the new invoice form to the draft list', () => {
    expect(
      reduceInvoicingPageMode('newInvoice', { type: 'showDraftList' }),
    ).toBe('draftList');
  });
});
