import type { InvoiceDraft } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import {
  initialInvoiceDraftEditorState,
  reduceInvoiceDraftEditor,
  type InvoiceDraftEditorAction,
} from './invoiceDraftEditorState.js';

const draftA = createDraft('draft-a');
const draftB = createDraft('draft-b');

describe('invoice draft opening ownership', () => {
  it.each(['loaded', 'failed'] as const)(
    'ignores an old %s result while the current target is loading or loaded',
    (type) => {
      const oldResult: InvoiceDraftEditorAction = type === 'loaded'
        ? { type, sessionRevision: 1, draft: draftA }
        : { type, sessionRevision: 1, errorMessage: 'Safe old failure' };
      const openingA = reduceInvoicing({ type: 'open', sessionRevision: 1 });
      const openingB = reduceInvoiceDraftEditor(openingA, {
        type: 'open', sessionRevision: 2,
      });
      expect(reduceInvoiceDraftEditor(openingB, oldResult)).toBe(openingB);
      expect(openingB.isLoading).toBe(true);

      const loadedB = reduceInvoiceDraftEditor(openingB, {
        type: 'loaded', sessionRevision: 2, draft: draftB,
      });
      expect(reduceInvoiceDraftEditor(loadedB, oldResult)).toBe(loadedB);
      expect(loadedB).toEqual({
        draft: draftB, errorMessage: null, isLoading: false, sessionRevision: 2,
      });
    },
  );

  it('distinguishes two opens of the same draft', () => {
    const current = reduceInvoicing({ type: 'open', sessionRevision: 2 });
    const latestDraft = { ...draftA, subject: 'Newer read' };
    const loaded = reduceInvoiceDraftEditor(current, {
      type: 'loaded', sessionRevision: 2, draft: latestDraft,
    });
    expect(reduceInvoiceDraftEditor(loaded, {
      type: 'loaded', sessionRevision: 1, draft: draftA,
    })).toBe(loaded);
    expect(loaded.draft).toBe(latestDraft);
  });

  it('clears loading and invalidates success and failure when leaving the editor', () => {
    const opening = reduceInvoicing({ type: 'open', sessionRevision: 1 });
    const cleared = reduceInvoiceDraftEditor(opening, {
      type: 'clear', sessionRevision: 2,
    });
    expect(cleared).toEqual({
      ...initialInvoiceDraftEditorState, sessionRevision: 2,
    });
    expect(reduceInvoiceDraftEditor(cleared, {
      type: 'loaded', sessionRevision: 1, draft: draftA,
    })).toBe(cleared);
    expect(reduceInvoiceDraftEditor(cleared, {
      type: 'failed', sessionRevision: 1, errorMessage: 'Safe old failure',
    })).toBe(cleared);
  });

  it('preserves the current error against an older successful response', () => {
    const opening = reduceInvoicing({ type: 'open', sessionRevision: 2 });
    const failed = reduceInvoiceDraftEditor(opening, {
      type: 'failed', sessionRevision: 2, errorMessage: 'Safe current failure',
    });
    expect(failed).toMatchObject({
      draft: null, isLoading: false, errorMessage: 'Safe current failure',
    });
    expect(reduceInvoiceDraftEditor(failed, {
      type: 'loaded', sessionRevision: 1, draft: draftA,
    })).toBe(failed);
    expect(reduceInvoiceDraftEditor(failed, {
      type: 'open', sessionRevision: 3,
    })).toEqual({
      draft: null, errorMessage: null, isLoading: true, sessionRevision: 3,
    });
  });

  it('starts a distinct session for an already loaded copy', () => {
    const opening = reduceInvoicing({ type: 'open', sessionRevision: 1 });
    const copied = reduceInvoiceDraftEditor(opening, {
      type: 'openLoaded', sessionRevision: 2, draft: draftB,
    });
    expect(copied).toEqual({
      draft: draftB, errorMessage: null, isLoading: false, sessionRevision: 2,
    });
    expect(reduceInvoiceDraftEditor(copied, {
      type: 'loaded', sessionRevision: 1, draft: draftA,
    })).toBe(copied);
  });

  it('keeps the form session across first create and subsequent save responses', () => {
    const creating = reduceInvoicing({ type: 'clear', sessionRevision: 4 });
    const created = reduceInvoiceDraftEditor(creating, {
      type: 'saved', sessionRevision: 4, draft: draftA,
    });
    const updated = reduceInvoiceDraftEditor(created, {
      type: 'saved', sessionRevision: 4, draft: { ...draftA, subject: 'Saved change' },
    });
    expect(created.sessionRevision).toBe(4);
    expect(updated.sessionRevision).toBe(4);
    expect(updated.draft?.subject).toBe('Saved change');
  });

  it.each(['clear', 'open', 'openLoaded'] as const)(
    'ignores a departed session save after %s', (type) => {
      const current = reduceInvoicing(type === 'openLoaded'
        ? { type, sessionRevision: 5, draft: draftB }
        : { type, sessionRevision: 5 });
      expect(reduceInvoiceDraftEditor(current, {
        type: 'saved', sessionRevision: 4, draft: draftA,
      })).toBe(current);
    },
  );
});

function reduceInvoicing(action: InvoiceDraftEditorAction) {
  return reduceInvoiceDraftEditor(initialInvoiceDraftEditorState, action);
}

function createDraft(id: string): InvoiceDraft {
  return {
    id,
    companyId: 'synthetic-company',
    customerId: 'synthetic-customer',
    billingRecipientCustomerId: null,
    createdAt: '2026-06-16T12:00:00.000Z',
    updatedAt: '2026-06-16T12:00:00.000Z',
    deliveryAddressText: '',
    dueDate: '2026-06-30',
    invoiceDate: '2026-06-16',
    lines: [],
    note: '',
    orderNumber: '',
    paymentTermDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    performancePeriod: { type: 'invoiceDate' },
    reminderPeriodDays: 0,
    status: 'draft',
    subject: id,
    totals: {
      grossTotalCents: 0, netTotalCents: 0, vatBreakdown: [], vatTotalCents: 0,
    },
  };
}
