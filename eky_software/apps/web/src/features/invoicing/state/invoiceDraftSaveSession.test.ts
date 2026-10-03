import type { InvoiceDraft } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { InvoiceDraftSaveSession, type InvoiceDraftSaveMode } from './invoiceDraftSaveSession.js';

describe('InvoiceDraftSaveSession', () => {
  it.each(['auto', 'manual'] as const)('retains %s create identity without acknowledging newer edits', (source) => {
    const session = createSession();
    session.markEdited();
    const request = session.begin(1, source)!;
    expect(request.mode).toEqual({ type: 'create' });
    session.markEdited();
    expect(session.begin(2, 'auto')).toBeNull();
    expect(session.begin(2, 'manual')).toBeNull();
    expect(session.succeed(request, draft)).toEqual({ isCurrentRevision: false });
    expect(session.getSnapshot()).toMatchObject({ revision: 2, savedRevision: 1, isSaving: false });
    expect(session.isSaved()).toBe(false);
    const update = session.begin(2, 'auto')!;
    expect(update.mode).toEqual({ type: 'edit', draftId: draft.id });
    expect(session.succeed(update, { ...draft, subject: 'Newer input' })).toEqual({ isCurrentRevision: true });
    expect(session.isSaved()).toBe(true);
    expect(session.getSnapshot().savedDraft?.subject).toBe('Newer input');
    expect(session.begin(2, 'manual')).toBeNull();
  });

  it('serializes both writers and rejects stale scheduled input', () => {
    const session = createSession();
    session.markEdited();
    session.markEdited();
    expect(session.begin(1, 'auto')).toBeNull();
    const request = session.begin(2, 'manual')!;
    expect(session.begin(2, 'manual')).toBeNull();
    expect(session.begin(2, 'auto')).toBeNull();
    session.succeed(request, draft);
    session.markEdited();
    const update = session.begin(3, 'manual')!;
    expect(session.succeed(request, draft)).toBeNull();
    expect(session.fail(request, 'Old error', true)).toBe(false);
    expect(session.getSnapshot().isSaving).toBe(true);
    session.succeed(update, draft);
    expect(session.isSaved()).toBe(true);
  });

  it.each(['auto', 'manual'] as const)('blocks all new creates after uncertain %s outcome despite edits', (source) => {
    const session = createSession();
    session.markEdited();
    const request = session.begin(1, source)!;
    session.markEdited();
    expect(session.fail(request, 'Safe uncertain outcome', false)).toBe(true);
    session.markEdited();
    session.clearError();
    expect(session.getSnapshot()).toMatchObject({
      revision: 3, isSaving: false, isCreateOutcomeUnknown: true,
      errorMessage: 'Safe uncertain outcome', savedRevision: -1,
    });
    expect(session.begin(3, 'auto')).toBeNull();
    expect(session.begin(3, 'manual')).toBeNull();
    expect(session.isSaved()).toBe(false);
  });

  it('allows a corrected create after confirmed rejection, without automatic repeat of unchanged input', () => {
    const session = createSession();
    session.markEdited();
    session.fail(session.begin(1, 'auto')!, 'Validation rejected', true);
    expect(session.begin(1, 'auto')).toBeNull();
    session.markEdited();
    expect(session.getSnapshot().errorMessage).toBeNull();
    const corrected = session.begin(2, 'auto')!;
    expect(corrected.mode).toEqual({ type: 'create' });
    session.succeed(corrected, draft);
    expect(session.isSaved()).toBe(true);
  });

  it('does not show a stale known failure against newer input', () => {
    const session = createSession();
    session.markEdited();
    const request = session.begin(1, 'manual')!;
    session.markEdited();
    session.fail(request, 'Old validation error', true);
    expect(session.getSnapshot()).toMatchObject({ isSaving: false, errorMessage: null });
    expect(session.begin(2, 'auto')).not.toBeNull();
  });

  it('keeps a known ID after update failure and allows explicit retry', () => {
    const session = createSession({ type: 'edit', draftId: draft.id });
    expect(session.isSaved()).toBe(true);
    session.markEdited();
    session.fail(session.begin(1, 'auto')!, 'Update failed', false);
    expect(session.begin(1, 'auto')).toBeNull();
    expect(session.getSnapshot().isCreateOutcomeUnknown).toBe(false);
    expect(session.begin(1, 'manual')?.mode).toEqual({ type: 'edit', draftId: draft.id });
  });

  it.each(['success', 'failure'] as const)('ignores departed session %s, including release of the new writer', (outcome) => {
    const old = createSession();
    old.markEdited();
    const request = old.begin(1, 'auto')!;
    old.setActive(false);
    const current = createSession();
    current.markEdited();
    const currentRequest = current.begin(1, 'manual')!;
    const before = current.getSnapshot();
    if (outcome === 'success') {
      expect(old.succeed(request, draft)).toBeNull();
      expect(current.succeed(request, draft)).toBeNull();
    } else {
      expect(old.fail(request, 'Old error', false)).toBe(false);
      expect(current.fail(request, 'Old error', false)).toBe(false);
    }
    expect(current.getSnapshot()).toBe(before);
    expect(old.begin(1, 'manual')).toBeNull();
    expect(old.isSaved()).toBe(false);
    current.succeed(currentRequest, draft);
    expect(current.isSaved()).toBe(true);
  });

  it('preserves ownership across a synchronous effect replay', () => {
    const session = createSession();
    session.markEdited();
    const request = session.begin(1, 'auto')!;
    session.setActive(false);
    session.setActive(true);
    expect(session.begin(1, 'manual')).toBeNull();
    expect(session.succeed(request, draft)).toEqual({ isCurrentRevision: true });
  });
});

function createSession(mode: InvoiceDraftSaveMode = { type: 'create' }) {
  const session = new InvoiceDraftSaveSession(mode);
  session.setActive(true);
  return session;
}

const draft: InvoiceDraft = {
  id: 'synthetic-draft', companyId: 'synthetic-company', customerId: 'synthetic-customer',
  billingRecipientCustomerId: null, createdAt: '2026-06-16T12:00:00.000Z',
  updatedAt: '2026-06-16T12:00:00.000Z', deliveryAddressText: '',
  dueDate: '2026-06-30', invoiceDate: '2026-06-16', lines: [], note: '', orderNumber: '',
  paymentTermDays: 14, latePaymentInterestBasisPoints: 950, priceInputMode: 'net',
  taxTreatment: 'normalVat', performancePeriod: { type: 'invoiceDate' },
  reminderPeriodDays: 0, status: 'draft', subject: 'Original input',
  totals: { grossTotalCents: 0, netTotalCents: 0, vatBreakdown: [], vatTotalCents: 0 },
};
