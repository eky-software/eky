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

  it('opens the invoice draft edit form from the draft list', () => {
    expect(
      reduceInvoicingPageMode('draftList', { type: 'openEditInvoice' }),
    ).toBe('editInvoice');
  });

  it('opens an approved invoice preview from the draft edit form', () => {
    expect(
      reduceInvoicingPageMode('editInvoice', { type: 'openApprovedInvoice' }),
    ).toBe('approvedInvoice');
  });

  it('opens the dedicated credit invoice editor', () => {
    expect(
      reduceInvoicingPageMode('approvedInvoice', {
        type: 'openCreditInvoice',
      }),
    ).toBe('creditInvoice');
  });

  it('switches a saved new invoice draft into edit mode', () => {
    expect(
      reduceInvoicingPageMode('newInvoice', { type: 'draftSaved' }),
    ).toBe('editInvoice');
  });

  it('keeps a saved existing invoice draft in edit mode', () => {
    expect(
      reduceInvoicingPageMode('editInvoice', { type: 'draftSaved' }),
    ).toBe('editInvoice');
  });
});
