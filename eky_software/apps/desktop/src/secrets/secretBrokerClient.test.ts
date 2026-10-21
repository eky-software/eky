import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyEmailSecretBrokerClient } from './secretBrokerClient.js';
import { SecretBrokerError } from './secretBrokerErrors.js';
import { readSecretBrokerBinding } from './secretBrokerProtocol.js';
import { ControlledSecretTransport } from './secretBrokerTestSupport.js';

describe('secret broker client generation admission', () => {
  const clients: CompanyEmailSecretBrokerClient[] = [];
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    for (const client of clients.splice(0)) {
      try { client.close(); } catch { /* Failure assertions belong to each test. */ }
    }
    vi.useRealTimers();
  });

  function fixture(transport = new ControlledSecretTransport()) {
    const generationId = randomUUID();
    const client = new CompanyEmailSecretBrokerClient(transport, { generationId, now: () => now });
    clients.push(client);
    const reply = (extra: Record<string, unknown> = {}) => {
      const binding = readSecretBrokerBinding(transport.messages.at(-1));
      if (binding === undefined) throw new Error('Synthetic request missing.');
      transport.receive({ ...binding, ok: true, result: { configured: true }, ...extra });
    };
    return { client, transport, generationId, reply };
  }

  it('defaults errors to unknown and requires an explicit generation', () => {
    expect(new SecretBrokerError('SECRET_WRITE_FAILED').effect).toBe('unknown');
    expect(new SecretBrokerError('SECRET_WRITE_FAILED', 'noEffect').effect).toBe('noEffect');
    expect(() => new CompanyEmailSecretBrokerClient(new ControlledSecretTransport(), {
      generationId: '',
    })).toThrow(SecretBrokerError);
  });

  it('uses the supplied audit UUID without transformation and rejects invalid UUIDs before send', async () => {
    const f = fixture();
    const operationId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const set = f.client.setSecret({ companyId: 'example-company', secret: 'synthetic', operationId });
    expect(readSecretBrokerBinding(f.transport.messages[0])?.requestId).toBe(operationId);
    expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
    f.reply();
    await set;
    const removeId = randomUUID();
    const remove = f.client.removeSecret('example-company', removeId);
    expect(readSecretBrokerBinding(f.transport.messages[1])?.requestId).toBe(removeId);
    f.reply({ result: { configured: false } });
    await remove;
    await expect(f.client.removeSecret('example-company', 'invalid')).rejects.toMatchObject({ effect: 'noEffect' });
    await expect(f.client.setSecret({ companyId: 'example-company', secret: 'synthetic', operationId: '' }))
      .rejects.toMatchObject({ effect: 'noEffect' });
    expect(f.transport.messages.length).toBe(2);
    expect(() => f.client.assertSettled()).not.toThrow();
  });

  it('serializes all operations and accepts the exact normal null read', async () => {
    const f = fixture();
    const first = f.client.setSecret({ companyId: 'example-company', secret: 'synthetic' });
    const second = f.client.hasSecret('example-company');
    const third = f.client.getSecret('example-company');
    expect(f.transport.messages.length).toBe(1);
    f.reply();
    await first;
    expect(f.transport.messages.length).toBe(2);
    f.reply({ result: { configured: false } });
    await expect(second).resolves.toBe(false);
    expect(f.transport.messages.length).toBe(3);
    f.reply({ result: { secret: null } });
    await expect(third).resolves.toBeNull();
    expect(() => f.client.assertSettled()).not.toThrow();
  });

  it('keeps the original enqueue deadline when a queued request starts', async () => {
    const f = fixture();
    const first = f.client.hasSecret('example-company');
    now = 1_000;
    vi.advanceTimersByTime(1_000);
    const second = f.client.hasSecret('example-company');
    const rejected = expect(second).rejects.toMatchObject({ code: 'SECRET_BROKER_TIMEOUT', effect: 'unknown' });
    now = 9_999;
    vi.advanceTimersByTime(8_999);
    f.reply();
    await first;
    expect(f.transport.messages.length).toBe(2);
    now = 11_000;
    vi.advanceTimersByTime(1_001);
    await rejected;
    expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
  });

  it.each(['success', 'noEffect', 'timeout', 'terminal'] as const)(
    'seals queued work while preserving the active %s receipt and original deadline', async outcome => {
      const f = fixture();
      const first = f.client.setSecret({ companyId: 'example-company', secret: 'synthetic' });
      const active = f.client.removeSecret('example-company');
      const activeResult = active.then(() => ({ ok: true }), error => ({ ok: false, error }));
      const queued = f.client.hasSecret('example-company');
      const queuedResult = expect(queued).rejects.toMatchObject({ effect: 'noEffect' });
      f.reply();
      await first;
      expect(f.transport.messages.length).toBe(2);
      now = 4_000;
      vi.advanceTimersByTime(4_000);
      f.client.sealAdmission();
      f.client.sealAdmission();
      await queuedResult;
      expect(f.transport.closeCount).toBe(0);
      expect(vi.getTimerCount()).toBe(1);
      expect(() => f.client.assertSettled()).toThrow();
      for (const request of [
        () => f.client.getSecret('example-company'), () => f.client.hasSecret('example-company'),
        () => f.client.setSecret({ companyId: 'example-company', secret: 'synthetic' }),
        () => f.client.removeSecret('example-company'),
      ]) await expect(request()).rejects.toMatchObject({ effect: 'noEffect' });
      if (outcome === 'success') f.reply({ result: { configured: false } });
      if (outcome === 'noEffect') f.transport.receive({
        ...readSecretBrokerBinding(f.transport.messages.at(-1)),
        ok: false, errorCode: 'SECRET_WRITE_FAILED', effect: 'noEffect',
      });
      if (outcome === 'terminal') f.transport.terminate('closed');
      if (outcome === 'timeout') {
        now = 10_000;
        vi.advanceTimersByTime(6_000);
      }
      expect(await activeResult).toMatchObject(outcome === 'success'
        ? { ok: true } : { ok: false, error: { effect: outcome === 'noEffect' ? 'noEffect' : 'unknown' } });
      expect(f.transport.messages.length).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
      if (outcome === 'success' || outcome === 'noEffect') expect(() => f.client.assertSettled()).not.toThrow();
      else expect(() => f.client.assertSettled()).toThrow();
    },
  );

  it('rejects an expired unsent request without dispatch even when its timer is late', async () => {
    const transport = new ControlledSecretTransport();
    let advanceOnNextRead = false;
    const client = new CompanyEmailSecretBrokerClient(transport, {
      generationId: randomUUID(),
      now: () => {
        const value = now;
        if (advanceOnNextRead) now = 10_000;
        return value;
      },
    });
    clients.push(client);
    const first = client.hasSecret('example-company');
    const second = client.hasSecret('example-company');
    const rejected = expect(second).rejects.toMatchObject({ effect: 'noEffect' });
    now = 9_999;
    advanceOnNextRead = true;
    transport.receive({ ...readSecretBrokerBinding(transport.messages[0]), ok: true, result: { configured: false } });
    await expect(first).resolves.toBe(false);
    await rejected;
    expect(transport.messages.length).toBe(1);
    expect(() => client.assertSettled()).not.toThrow();
  });

  it('rejects duplicate in-flight audit ids without sending or disturbing the original request', async () => {
    const f = fixture();
    const operationId = randomUUID();
    const first = f.client.setSecret({ companyId: 'example-company', secret: 'synthetic', operationId });
    await expect(f.client.removeSecret('example-company', operationId)).rejects.toMatchObject({ effect: 'noEffect' });
    expect(f.transport.messages.length).toBe(1);
    f.reply();
    await first;
    expect(() => f.client.assertSettled()).not.toThrow();
  });

  it('re-arms an early timer against the original monotonic budget', async () => {
    const f = fixture();
    const result = expect(f.client.hasSecret('example-company')).rejects.toMatchObject({ code: 'SECRET_BROKER_TIMEOUT' });
    now = 9_999;
    vi.advanceTimersByTime(10_000);
    expect(f.transport.closeCount).toBe(0);
    now = 10_000;
    vi.advanceTimersByTime(1);
    await result;
    expect(f.transport.closeCount).toBe(1);
  });

  it('fences before caller settlement, rejects queued/new work, and ignores late success', async () => {
    const f = fixture();
    const first = f.client.setSecret({ companyId: 'example-company', secret: 'synthetic' });
    const queued = f.client.removeSecret('example-company');
    const queuedResult = expect(queued).rejects.toMatchObject({ effect: 'noEffect' });
    const firstResult = first.catch(async error => {
      expect(error).toMatchObject({ effect: 'unknown' });
      await expect(f.client.hasSecret('example-company')).rejects.toMatchObject({ effect: 'noEffect' });
    });
    now = 10_000;
    vi.advanceTimersByTime(10_000);
    await firstResult;
    await queuedResult;
    f.reply();
    f.client.close();
    expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
    expect(f.transport.messages.length).toBe(1);
    const replacement = new CompanyEmailSecretBrokerClient(f.transport, { generationId: f.generationId });
    clients.push(replacement);
    await expect(replacement.hasSecret('example-company')).rejects.toMatchObject({ effect: 'noEffect' });
    expect(() => replacement.assertSettled()).toThrow(SecretBrokerError);
  });

  it.each(['generationId', 'companyId', 'operation', 'requestId', 'protocolVersion', 'result', 'missing', 'raw'])
    ('fences mismatched or malformed %s before dispatching queued work', async field => {
      const f = fixture();
      const first = f.client.setSecret({ companyId: 'example-company', secret: 'synthetic' });
      const second = f.client.hasSecret('example-company');
      const firstResult = expect(first).rejects.toMatchObject({ effect: 'unknown' });
      const secondResult = expect(second).rejects.toMatchObject({ effect: 'noEffect' });
      const changes: Record<string, unknown> = {
        generationId: randomUUID(), companyId: 'other-company', operation: 'hasCompanyEmailSecret',
        requestId: randomUUID(), protocolVersion: 1, result: { configured: false }, missing: undefined,
      };
      if (field === 'raw') f.transport.receive(null);
      else if (field === 'missing') f.reply({ generationId: undefined });
      else f.reply({ [field]: changes[field] });
      await firstResult;
      await secondResult;
      expect(f.transport.messages.length).toBe(1);
      expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
    });

  it('continues only after a fully bound proven no-effect response', async () => {
    const f = fixture();
    const first = f.client.setSecret({ companyId: 'example-company', secret: 'synthetic' });
    const rejected = expect(first).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE', effect: 'noEffect' });
    const second = f.client.hasSecret('example-company');
    const binding = readSecretBrokerBinding(f.transport.messages[0]);
    f.transport.receive({ ...binding, ok: false, errorCode: 'SECRET_STORAGE_UNAVAILABLE', effect: 'noEffect' });
    await rejected;
    f.reply();
    await expect(second).resolves.toBe(true);
    expect(() => f.client.assertSettled()).not.toThrow();
  });

  it.each(['unknown', 'terminal', 'send', 'close'] as const)('preserves %s uncertainty after close', async kind => {
    const f = fixture();
    if (kind === 'send') f.transport.beforeSend = () => { throw new Error('Synthetic send failure.'); };
    const first = f.client.hasSecret('example-company');
    const rejected = expect(first).rejects.toMatchObject({ effect: 'unknown' });
    if (kind === 'terminal') f.transport.terminate('error');
    if (kind === 'close') f.client.close();
    if (kind === 'unknown') {
      f.transport.receive({ ...readSecretBrokerBinding(f.transport.messages[0]),
        ok: false, errorCode: 'SECRET_WRITE_FAILED', effect: 'unknown' });
    }
    await rejected;
    f.client.close();
    expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
  });

  it('attempts every teardown and preserves cleanup failure on repeated close', () => {
    const f = fixture();
    f.transport.failUnsubscribe = true;
    f.transport.failClose = true;
    let first: unknown;
    try { f.client.close(); } catch (error) { first = error; }
    expect(first).toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    expect(() => f.client.close()).toThrow(first as Error);
    expect(f.transport.unsubscribeCount).toBe(2);
    expect(f.transport.closeCount).toBe(1);
    expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
  });
});
