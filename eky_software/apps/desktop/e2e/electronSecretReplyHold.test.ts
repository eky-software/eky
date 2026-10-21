import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { MessagePortMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { createSecretBrokerRequest } from '../src/secrets/secretBrokerProtocol.js';
import { createElectronSecretReplyHold } from './electronSecretReplyHold.js';

const generationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const companyId = 'synthetic-company';

function createFixture() {
  const main = Object.assign(new EventEmitter(), { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() });
  const backend = Object.assign(new EventEmitter(), { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() });
  const relay = createElectronSecretReplyHold(
    main as unknown as MessagePortMain, backend as unknown as MessagePortMain, generationId,
  );
  return { main, backend, relay };
}

describe('test-only secret acknowledgment hold', () => {
  it.each(['setCompanyEmailSecret', 'removeCompanyEmailSecret'] as const)(
    'holds one bound %s acknowledgment and releases it once', operation => {
      const f = createFixture();
      try {
        const request = createSecretBrokerRequest({ companyId, generationId, requestId, operation,
          ...(operation === 'setCompanyEmailSecret' ? { secret: 'synthetic-only' } : {}) });
        const { secret: _, ...binding } = { ...request, secret: undefined };
        const reply = { ...binding, ok: true, result: { configured: operation === 'setCompanyEmailSecret' } };
        f.relay.arm(operation);
        f.backend.emit('message', { data: request });
        expect(f.main.postMessage).toHaveBeenCalledExactlyOnceWith(request);
        f.main.emit('message', { data: reply });
        expect(f.backend.postMessage).not.toHaveBeenCalled();
        expect(f.relay.snapshot()).toEqual({ held: true, released: false, disposed: false });
        f.relay.release();
        f.relay.release();
        expect(f.backend.postMessage).toHaveBeenCalledExactlyOnceWith(reply);
        expect(f.relay.snapshot()).toEqual({ held: false, released: true, disposed: false });
        expect(() => f.relay.arm(operation)).toThrow('ELECTRON_SECRET_REPLY_HOLD_INVALID');
      } finally { f.relay.dispose(); }
    },
  );

  it.each(['companyId', 'generationId', 'requestId', 'operation'] as const)(
    'does not hold a response with a different %s', key => {
      const f = createFixture();
      try {
        const request = createSecretBrokerRequest({ companyId, generationId, requestId, operation: 'removeCompanyEmailSecret' });
        f.relay.arm('removeCompanyEmailSecret');
        f.backend.emit('message', { data: request });
        const reply = { ...request, ok: true, result: { configured: false },
          [key]: key === 'operation' ? 'hasCompanyEmailSecret'
            : key === 'companyId' ? 'another-company' : '33333333-3333-4333-8333-333333333333' };
        f.main.emit('message', { data: reply });
        expect(f.backend.postMessage).toHaveBeenCalledExactlyOnceWith(reply);
        expect(f.relay.snapshot().held).toBe(false);
      } finally { f.relay.dispose(); }
    },
  );

  it('passes normal, malformed and failure messages without holding them', () => {
    const f = createFixture();
    try {
      const request = createSecretBrokerRequest({ companyId, generationId, requestId, operation: 'removeCompanyEmailSecret' });
      f.relay.arm('removeCompanyEmailSecret');
      f.backend.emit('message', { data: request });
      for (const data of [null, { ...request, ok: false, effect: 'unknown', errorCode: 'SECRET_BROKER_UNAVAILABLE' }]) {
        f.main.emit('message', { data });
        expect(f.backend.postMessage).toHaveBeenLastCalledWith(data);
      }
      expect(f.relay.snapshot().held).toBe(false);
    } finally { f.relay.dispose(); }
  });

  it('does not retain a delayed response after cancellation or peer close', () => {
    const f = createFixture();
    const request = createSecretBrokerRequest({ companyId, generationId, requestId, operation: 'removeCompanyEmailSecret' });
    f.relay.arm('removeCompanyEmailSecret');
    f.backend.emit('message', { data: request });
    f.relay.release();
    f.main.emit('message', { data: { ...request, ok: true, result: { configured: false } } });
    expect(f.backend.postMessage).toHaveBeenCalledOnce();
    f.backend.emit('close');
    f.relay.dispose();
    expect(f.main.close).toHaveBeenCalledOnce();
    expect(f.backend.close).toHaveBeenCalledOnce();
    expect(f.main.listenerCount('message')).toBe(0);
    expect(f.backend.listenerCount('message')).toBe(0);
  });

  it('rejects duplicate held replies instead of bypassing the hold', () => {
    const f = createFixture();
    const request = createSecretBrokerRequest({ companyId, generationId, requestId, operation: 'removeCompanyEmailSecret' });
    f.relay.arm('removeCompanyEmailSecret');
    f.backend.emit('message', { data: request });
    const reply = { ...request, ok: true, result: { configured: false } };
    f.main.emit('message', { data: reply });
    f.main.emit('message', { data: reply });
    f.relay.release();
    expect(f.backend.postMessage).not.toHaveBeenCalled();
    expect(() => f.relay.snapshot()).toThrow('ELECTRON_SECRET_REPLY_RELAY_FAILED');
    expect(f.main.close).toHaveBeenCalledOnce();
  });

  it('retains forwarding failure while attempting both closes', () => {
    const f = createFixture();
    f.main.postMessage.mockImplementation(() => { throw new Error('synthetic-forwarding-failure'); });
    f.main.close.mockImplementation(() => { throw new Error('synthetic-close-failure'); });
    f.backend.emit('message', { data: {} });
    expect(f.backend.close).toHaveBeenCalledOnce();
    expect(() => f.relay.snapshot()).toThrow(expect.objectContaining({
      cause: expect.objectContaining({ message: 'synthetic-forwarding-failure' }),
    }));
  });

  it('is wired only in the two named E2E scenarios and not the production entrypoint', () => {
    const source = readFileSync(new URL('./electronE2eEntrypoint.ts', import.meta.url), 'utf8');
    expect(source).toContain("config.scenarioId === 'DESK-SECRET-DRAIN-001'");
    expect(source).toContain("config.scenarioId === 'DESK-SECRET-DRAIN-002'");
    expect(source).toContain('await handle.stop()');
    expect(source).toContain('finally { secretReplyHold?.dispose(); }');
    const production = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    expect(production).not.toMatch(/secretReplyProof|electronSecretReplyHold|DESK-SECRET-DRAIN/);
  });
});
