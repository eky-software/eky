import { describe, expect, it } from 'vitest';

import { InvoiceEmailSendAttemptError } from '../application/invoiceEmailSendAttemptError.js';
import { InMemoryInvoiceEmailSendAttemptStore } from './inMemoryInvoiceEmailSendAttemptStore.js';

describe('InMemoryInvoiceEmailSendAttemptStore', () => {
  it('binds a one-time authorization to actor, company, invoice, mode and request', () => {
    const store = new InMemoryInvoiceEmailSendAttemptStore();
    const binding = createBinding();
    const preparation = store.prepare(binding);

    expect(() => store.acquire({ ...binding, ...preparation })).not.toThrow();
    expect(() => store.acquire({ ...binding, ...preparation })).toThrowError(
      InvoiceEmailSendAttemptError,
    );
  });

  it.each([
    { actorId: 'other-user' },
    { companyId: 'other-company' },
    { invoiceId: 'other-invoice' },
    { mode: 'smtpTest' as const },
    { recipient: 'other@example.fi' },
    { requestFingerprint: 'other-fingerprint' },
  ])('rejects a mismatching binding without consuming it: %o', (override) => {
    const store = new InMemoryInvoiceEmailSendAttemptStore();
    const binding = createBinding();
    const preparation = store.prepare(binding);

    expect(() =>
      store.acquire({ ...binding, ...preparation, ...override }),
    ).toThrowError(InvoiceEmailSendAttemptError);
    expect(() => store.acquire({ ...binding, ...preparation })).not.toThrow();
  });

  it('replaces an unused preparation so a cancelled confirmation can be retried', () => {
    const store = new InMemoryInvoiceEmailSendAttemptStore();
    const binding = createBinding();
    const firstPreparation = store.prepare(binding);
    const secondPreparation = store.prepare({
      ...binding,
      mode: 'smtpTest',
      recipient: 'owner-test@example.fi',
    });

    expect(() =>
      store.acquire({ ...binding, ...firstPreparation }),
    ).toThrowError(new InvoiceEmailSendAttemptError('invalidOrExpired'));
    expect(() =>
      store.acquire({
        ...binding,
        ...secondPreparation,
        mode: 'smtpTest',
        recipient: 'owner-test@example.fi',
      }),
    ).not.toThrow();
  });

  it('blocks a new preparation while an SMTP delivery is already in flight', () => {
    const store = new InMemoryInvoiceEmailSendAttemptStore();
    const binding = createBinding();
    const preparation = store.prepare(binding);

    store.acquire({ ...binding, ...preparation });
    expect(() =>
      store.prepare({
        ...binding,
        mode: 'smtpTest',
        recipient: 'owner-test@example.fi',
      }),
    ).toThrowError(new InvoiceEmailSendAttemptError('inProgress'));
  });

  it('releases a failed in-flight attempt without a cooldown', () => {
    const store = new InMemoryInvoiceEmailSendAttemptStore();
    const binding = createBinding();
    const preparation = store.prepare(binding);

    store.acquire({ ...binding, ...preparation });
    store.complete({ attemptId: preparation.attemptId, outcome: 'failed' });

    expect(() => store.prepare(binding)).not.toThrow();
  });

  it.each(['succeeded', 'outcomeUnknown'] as const)(
    'applies a short cooldown after %s without automatic retry',
    (outcome) => {
      let now = Date.parse('2026-07-16T10:00:00.000Z');
      const store = new InMemoryInvoiceEmailSendAttemptStore({
        cooldownMs: 10_000,
        now: () => now,
      });
      const binding = createBinding();
      const preparation = store.prepare(binding);

      store.acquire({ ...binding, ...preparation });
      store.complete({ attemptId: preparation.attemptId, outcome });

      expect(() => store.prepare(binding)).toThrowError(
        new InvoiceEmailSendAttemptError('cooldown'),
      );

      now += 10_001;

      expect(() => store.prepare(binding)).not.toThrow();
    },
  );

  it('expires an unused authorization and releases its invoice key', () => {
    let now = Date.parse('2026-07-16T10:00:00.000Z');
    const store = new InMemoryInvoiceEmailSendAttemptStore({
      authorizationLifetimeMs: 1_000,
      now: () => now,
    });
    const binding = createBinding();
    const preparation = store.prepare(binding);

    now += 1_001;

    expect(() => store.acquire({ ...binding, ...preparation })).toThrowError(
      new InvoiceEmailSendAttemptError('invalidOrExpired'),
    );
    expect(() => store.prepare(binding)).not.toThrow();
  });
});

function createBinding() {
  return {
    actorId: 'user-1',
    companyId: 'company-1',
    invoiceId: 'invoice-1',
    mode: 'customer' as const,
    provider: 'dnaSmtp' as const,
    recipient: 'customer@example.fi',
    requestFingerprint: 'request-fingerprint',
  };
}
