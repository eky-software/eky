import type { InvoiceIssuanceReadiness } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import {
  InvoiceReadinessSession,
  type InvoiceReadinessContext,
} from './invoiceReadinessSession.js';

const saved: InvoiceReadinessContext = {
  draftId: 'draft-1', formRevision: 2, isSaved: true,
};
const ready: InvoiceIssuanceReadiness = { isReady: true, issues: [] };
const notReady: InvoiceIssuanceReadiness = {
  isReady: false, issues: ['companyIbanMissing'],
};

function createSession(context = saved): InvoiceReadinessSession {
  const session = new InvoiceReadinessSession(context);
  session.setActive(true);
  return session;
}

function begin(session: InvoiceReadinessSession) {
  const request = session.begin();
  expect(request).not.toBeNull();
  if (request === null) {
    throw new Error('Expected a saved active draft to start readiness.');
  }
  return request;
}

describe('InvoiceReadinessSession', () => {
  it('requires a current successful check before confirmation', () => {
    const session = createSession();
    expect(session.canConfirm()).toBe(false);
    const request = begin(session);
    expect(request).toEqual({ draftId: 'draft-1', formRevision: 2 });
    expect(session.getSnapshot().isChecking).toBe(true);
    expect(session.canConfirm()).toBe(false);
    expect(session.succeed(request, ready)).toBe(true);
    expect(session.getSnapshot()).toEqual({
      readiness: ready, errorMessage: null, isChecking: false,
    });
    expect(session.canConfirm()).toBe(true);
  });

  it('does not start without an active saved persisted draft', () => {
    const inactive = new InvoiceReadinessSession(saved);
    expect(inactive.begin()).toBeNull();
    expect(inactive.canConfirm()).toBe(false);
    expect(createSession({ ...saved, draftId: null }).begin()).toBeNull();
    expect(createSession({ ...saved, isSaved: false }).begin()).toBeNull();
  });

  it('keeps one current check without resetting its busy state', () => {
    const session = createSession();
    const request = begin(session);
    expect(session.begin()).toBeNull();
    expect(session.getSnapshot().isChecking).toBe(true);
    expect(session.succeed(request, ready)).toBe(true);
  });

  for (const context of [
    { ...saved, draftId: 'draft-2' },
    { ...saved, formRevision: 3 },
    { ...saved, isSaved: false },
  ]) {
    it(`invalidates pending and accepted checks when context becomes ${JSON.stringify(context)}`, () => {
      const session = createSession();
      const older = begin(session);
      session.updateContext(context);
      expect(session.succeed(older, ready)).toBe(false);
      expect(session.fail(older, 'old error')).toBe(false);
      expect(session.canConfirm()).toBe(false);
      expect(session.getSnapshot()).toEqual({
        readiness: null, errorMessage: null, isChecking: false,
      });

      session.updateContext(saved);
      const current = begin(session);
      expect(session.succeed(current, ready)).toBe(true);
      expect(session.canConfirm()).toBe(true);
      session.updateContext(context);
      expect(session.canConfirm()).toBe(false);
      expect(session.getSnapshot().readiness).toBeNull();
    });
  }

  it('rejects old ready, not-ready and error outcomes after editing and saving again', () => {
    const session = createSession();
    const older = begin(session);
    session.clear();
    session.updateContext({ ...saved, formRevision: 3, isSaved: false });
    session.updateContext({ ...saved, formRevision: 3 });
    expect(session.succeed(older, ready)).toBe(false);
    expect(session.succeed(older, notReady)).toBe(false);
    expect(session.fail(older, 'old error')).toBe(false);
    expect(session.canConfirm()).toBe(false);
    const current = begin(session);
    expect(session.succeed(current, ready)).toBe(true);
    expect(session.canConfirm()).toBe(true);
  });

  it('cannot revive a request by returning to the same context', () => {
    const session = createSession();
    const older = begin(session);
    session.updateContext({ ...saved, isSaved: false });
    session.updateContext(saved);
    expect(session.succeed(older, ready)).toBe(false);
    expect(session.canConfirm()).toBe(false);
  });

  it('does not let an older completion change a newer busy state or confirmation', () => {
    const session = createSession();
    const older = begin(session);
    session.clear();
    const current = begin(session);
    expect(session.succeed(older, ready)).toBe(false);
    expect(session.fail(older, 'old error')).toBe(false);
    expect(session.getSnapshot()).toEqual({
      readiness: null, errorMessage: null, isChecking: true,
    });
    expect(session.succeed(current, ready)).toBe(true);
    expect(session.succeed(older, notReady)).toBe(false);
    expect(session.fail(older, 'old error')).toBe(false);
    expect(session.canConfirm()).toBe(true);
    expect(session.getSnapshot().errorMessage).toBeNull();
  });

  it('clears confirmation immediately on cancel, edit or a fresh check', () => {
    const session = createSession();
    session.succeed(begin(session), ready);
    session.clear();
    expect(session.canConfirm()).toBe(false);
    session.succeed(begin(session), ready);
    begin(session);
    expect(session.canConfirm()).toBe(false);
    expect(session.getSnapshot().readiness).toBeNull();
  });

  it('invalidates the old session on unmount including reactivation with the same ID', () => {
    const session = createSession();
    const older = begin(session);
    session.setActive(false);
    expect(session.succeed(older, ready)).toBe(false);
    expect(session.begin()).toBeNull();
    session.setActive(true);
    const current = begin(session);
    expect(session.fail(older, 'old error')).toBe(false);
    expect(session.succeed(current, ready)).toBe(true);
    session.setActive(false);
    expect(session.canConfirm()).toBe(false);
  });

  it('does not accept another editor session request for the same draft and revision', () => {
    const older = createSession();
    const current = createSession();
    const oldRequest = begin(older);
    const currentRequest = begin(current);
    expect(current.succeed(oldRequest, ready)).toBe(false);
    expect(current.fail(oldRequest, 'old error')).toBe(false);
    expect(current.getSnapshot().isChecking).toBe(true);
    expect(current.succeed(currentRequest, ready)).toBe(true);
  });

  it('keeps a valid result across unchanged context updates', () => {
    const session = createSession();
    const request = begin(session);
    session.updateContext({ ...saved });
    expect(session.succeed(request, ready)).toBe(true);
    session.updateContext({ ...saved });
    expect(session.canConfirm()).toBe(true);
  });

  it('shows current negative/error outcomes and permits a fresh successful check', () => {
    const session = createSession();
    const first = begin(session);
    expect(session.succeed(first, notReady)).toBe(true);
    expect(session.getSnapshot().readiness).toEqual(notReady);
    expect(session.canConfirm()).toBe(false);
    const second = begin(session);
    expect(session.getSnapshot().readiness).toBeNull();
    expect(session.fail(second, 'safe message')).toBe(true);
    expect(session.getSnapshot()).toEqual({
      readiness: null, errorMessage: 'safe message', isChecking: false,
    });
    expect(session.canConfirm()).toBe(false);
    expect(session.succeed(second, ready)).toBe(false);
    session.succeed(begin(session), ready);
    expect(session.getSnapshot().errorMessage).toBeNull();
    expect(session.canConfirm()).toBe(true);
  });
});
