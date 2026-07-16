import { describe, expect, it } from 'vitest';

import { InvoiceSmtpTestAttemptError } from '../application/invoiceSmtpTestAttemptError.js';
import { InMemoryInvoiceSmtpTestAttemptStore } from './inMemoryInvoiceSmtpTestAttemptStore.js';

describe('InMemoryInvoiceSmtpTestAttemptStore', () => {
  it('binds a one-time authorization to actor, company, invoice and request', () => {
    const store = new InMemoryInvoiceSmtpTestAttemptStore();
    const binding = createBinding();
    const preparation = store.prepare(binding);

    expect(() =>
      store.acquire({
        ...binding,
        ...preparation,
      }),
    ).not.toThrow();
    expect(() =>
      store.acquire({
        ...binding,
        ...preparation,
      }),
    ).toThrowError(InvoiceSmtpTestAttemptError);
  });

  it.each([
    { actorId: 'other-user' },
    { companyId: 'other-company' },
    { invoiceId: 'other-invoice' },
    { requestFingerprint: 'other-fingerprint' },
    { testRecipient: 'other@example.fi' },
  ])('rejects a mismatching binding without consuming it: %o', (override) => {
    const store = new InMemoryInvoiceSmtpTestAttemptStore();
    const binding = createBinding();
    const preparation = store.prepare(binding);

    expect(() =>
      store.acquire({ ...binding, ...preparation, ...override }),
    ).toThrowError(InvoiceSmtpTestAttemptError);
    expect(() =>
      store.acquire({ ...binding, ...preparation }),
    ).not.toThrow();
  });

  it('blocks parallel preparation and releases a failed in-flight attempt', () => {
    const store = new InMemoryInvoiceSmtpTestAttemptStore();
    const binding = createBinding();
    const preparation = store.prepare(binding);

    expect(() => store.prepare(binding)).toThrowError(
      new InvoiceSmtpTestAttemptError('inProgress'),
    );

    store.acquire({ ...binding, ...preparation });
    store.complete({ attemptId: preparation.attemptId, outcome: 'failed' });

    expect(() => store.prepare(binding)).not.toThrow();
  });

  it.each(['succeeded', 'outcomeUnknown'] as const)(
    'applies a short cooldown after %s without automatic retry',
    (outcome) => {
      let now = Date.parse('2026-07-16T10:00:00.000Z');
      const store = new InMemoryInvoiceSmtpTestAttemptStore({
        cooldownMs: 10_000,
        now: () => now,
      });
      const binding = createBinding();
      const preparation = store.prepare(binding);

      store.acquire({ ...binding, ...preparation });
      store.complete({ attemptId: preparation.attemptId, outcome });

      expect(() => store.prepare(binding)).toThrowError(
        new InvoiceSmtpTestAttemptError('cooldown'),
      );

      now += 10_001;

      expect(() => store.prepare(binding)).not.toThrow();
    },
  );

  it('expires an unused authorization and releases its invoice key', () => {
    let now = Date.parse('2026-07-16T10:00:00.000Z');
    const store = new InMemoryInvoiceSmtpTestAttemptStore({
      authorizationLifetimeMs: 1_000,
      now: () => now,
    });
    const binding = createBinding();
    const preparation = store.prepare(binding);

    now += 1_001;

    expect(() =>
      store.acquire({ ...binding, ...preparation }),
    ).toThrowError(new InvoiceSmtpTestAttemptError('invalidOrExpired'));
    expect(() => store.prepare(binding)).not.toThrow();
  });
});

function createBinding() {
  return {
    actorId: 'user-1',
    companyId: 'company-1',
    invoiceId: 'invoice-1',
    provider: 'dnaSmtp' as const,
    requestFingerprint: 'request-fingerprint',
    testRecipient: 'owner-test@example.fi',
  };
}
