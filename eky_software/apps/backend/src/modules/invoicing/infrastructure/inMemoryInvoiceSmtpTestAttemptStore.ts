import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { InvoiceSmtpTestAttemptError } from '../application/invoiceSmtpTestAttemptError.js';
import type {
  AcquireInvoiceSmtpTestAttemptInput,
  CompleteInvoiceSmtpTestAttemptInput,
  InvoiceSmtpTestAttemptStore,
  PrepareInvoiceSmtpTestAttemptInput,
  PreparedInvoiceSmtpTestAttempt,
} from '../ports/invoiceSmtpTestAttemptStore.js';

interface StoredAttempt extends PrepareInvoiceSmtpTestAttemptInput {
  attemptId: string;
  authorizationExpiresAtMs: number;
  authorizationTokenHash: Buffer;
  key: string;
  retentionExpiresAtMs: number;
  status: 'completed' | 'inFlight' | 'prepared';
}

export interface InMemoryInvoiceSmtpTestAttemptStoreOptions {
  authorizationLifetimeMs?: number;
  cooldownMs?: number;
  now?: () => number;
  retentionMs?: number;
}

const defaultAuthorizationLifetimeMs = 60_000;
const defaultCooldownMs = 10_000;
const defaultRetentionMs = 300_000;

export class InMemoryInvoiceSmtpTestAttemptStore
  implements InvoiceSmtpTestAttemptStore
{
  private readonly activeAttemptByKey = new Map<string, string>();
  private readonly attempts = new Map<string, StoredAttempt>();
  private readonly cooldownByKey = new Map<string, number>();
  private readonly authorizationLifetimeMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly retentionMs: number;

  constructor(options: InMemoryInvoiceSmtpTestAttemptStoreOptions = {}) {
    this.authorizationLifetimeMs =
      options.authorizationLifetimeMs ?? defaultAuthorizationLifetimeMs;
    this.cooldownMs = options.cooldownMs ?? defaultCooldownMs;
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? defaultRetentionMs;
  }

  prepare(
    input: PrepareInvoiceSmtpTestAttemptInput,
  ): PreparedInvoiceSmtpTestAttempt {
    const now = this.now();

    this.cleanup(now);

    const key = createAttemptKey(input);
    const activeAttemptId = this.activeAttemptByKey.get(key);

    if (activeAttemptId !== undefined) {
      throw new InvoiceSmtpTestAttemptError('inProgress');
    }

    const cooldownUntil = this.cooldownByKey.get(key);

    if (cooldownUntil !== undefined && cooldownUntil > now) {
      throw new InvoiceSmtpTestAttemptError('cooldown');
    }

    const attemptId = randomUUID();
    const authorizationToken = randomBytes(32).toString('base64url');
    const authorizationExpiresAtMs = now + this.authorizationLifetimeMs;
    const attempt: StoredAttempt = {
      ...input,
      attemptId,
      authorizationExpiresAtMs,
      authorizationTokenHash: hashAuthorizationToken(authorizationToken),
      key,
      retentionExpiresAtMs: now + this.retentionMs,
      status: 'prepared',
    };

    this.attempts.set(attemptId, attempt);
    this.activeAttemptByKey.set(key, attemptId);

    return {
      attemptId,
      authorizationToken,
      expiresAt: new Date(authorizationExpiresAtMs).toISOString(),
    };
  }

  acquire(input: AcquireInvoiceSmtpTestAttemptInput): void {
    const now = this.now();

    this.cleanup(now);

    const attempt = this.attempts.get(input.attemptId);
    const suppliedTokenHash = hashAuthorizationToken(input.authorizationToken);

    if (
      attempt === undefined ||
      attempt.status !== 'prepared' ||
      attempt.authorizationExpiresAtMs <= now ||
      !bindingsMatch(attempt, input) ||
      !timingSafeEqual(attempt.authorizationTokenHash, suppliedTokenHash)
    ) {
      throw new InvoiceSmtpTestAttemptError('invalidOrExpired');
    }

    attempt.status = 'inFlight';
    attempt.authorizationTokenHash.fill(0);
  }

  complete(input: CompleteInvoiceSmtpTestAttemptInput): void {
    const now = this.now();
    const attempt = this.attempts.get(input.attemptId);

    if (attempt === undefined || attempt.status !== 'inFlight') {
      return;
    }

    attempt.status = 'completed';
    this.activeAttemptByKey.delete(attempt.key);

    if (input.outcome === 'succeeded' || input.outcome === 'outcomeUnknown') {
      this.cooldownByKey.set(attempt.key, now + this.cooldownMs);
    }
  }

  private cleanup(now: number): void {
    for (const [attemptId, attempt] of this.attempts) {
      if (
        attempt.status === 'prepared' &&
        attempt.authorizationExpiresAtMs <= now
      ) {
        attempt.authorizationTokenHash.fill(0);
        this.activeAttemptByKey.delete(attempt.key);
        attempt.status = 'completed';
      }

      if (
        attempt.status === 'completed' &&
        attempt.retentionExpiresAtMs <= now
      ) {
        attempt.authorizationTokenHash.fill(0);
        this.attempts.delete(attemptId);
      }
    }

    for (const [key, cooldownUntil] of this.cooldownByKey) {
      if (cooldownUntil <= now) {
        this.cooldownByKey.delete(key);
      }
    }
  }
}

function createAttemptKey(input: PrepareInvoiceSmtpTestAttemptInput): string {
  return `${input.companyId}\u0000${input.invoiceId}\u0000${input.provider}`;
}

function hashAuthorizationToken(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function bindingsMatch(
  attempt: StoredAttempt,
  input: AcquireInvoiceSmtpTestAttemptInput,
): boolean {
  return (
    attempt.actorId === input.actorId &&
    attempt.companyId === input.companyId &&
    attempt.invoiceId === input.invoiceId &&
    attempt.provider === input.provider &&
    attempt.requestFingerprint === input.requestFingerprint &&
    attempt.testRecipient === input.testRecipient
  );
}
