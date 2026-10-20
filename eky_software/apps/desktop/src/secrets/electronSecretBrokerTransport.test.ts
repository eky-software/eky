import { EventEmitter } from 'node:events';

import type { MessagePortMain } from 'electron';
import { describe, expect, it } from 'vitest';

import { createMainSecretBrokerTransport, createUtilitySecretBrokerTransport } from './electronSecretBrokerTransport.js';
import { SecretBrokerError } from './secretBrokerErrors.js';
import type { SecretBrokerTerminal } from './secretBrokerTransport.js';

class TestPort extends EventEmitter {
  startCount = 0;
  closeCount = 0;
  sentCount = 0;
  offCount = 0;
  failStart = false;
  failSend = false;
  failClose = false;
  failOff = false;
  start(): void {
    this.startCount++;
    if (this.failStart) throw new Error('Synthetic start failure.');
  }
  close(): void {
    this.closeCount++;
    if (this.failClose) throw new Error('Synthetic close failure.');
    this.emit('close');
  }
  postMessage(): void {
    this.sentCount++;
    if (this.failSend) throw new Error('Synthetic send failure.');
  }
  override off(event: string | symbol, listener: (...args: any[]) => void): this {
    this.offCount++;
    super.off(event, listener);
    if (this.failOff) throw new Error('Synthetic listener cleanup failure.');
    return this;
  }
}

describe.each([
  ['main', createMainSecretBrokerTransport],
  ['utility', createUtilitySecretBrokerTransport],
] as const)('%s secret broker port transport', (_name, create) => {
  it('starts and delivers message data, then removes every owned listener on close', () => {
    const port = new TestPort();
    const transport = create(port as unknown as MessagePortMain);
    let count = 0;
    transport.subscribe(value => { if (value === 42) count++; });
    port.emit('message', { data: 42 });
    expect(count).toBe(1);
    transport.send({ protocolVersion: 2 });
    expect(port.sentCount).toBe(1);
    expect(port.startCount).toBe(1);
    transport.close();
    transport.close();
    expect(port.closeCount).toBe(1);
    expect(port.eventNames().length).toBe(0);
    expect(() => transport.send({})).toThrow(SecretBrokerError);
  });

  it.each(['close', 'send'] as const)('observes %s termination even before subscription and never revives', event => {
    const port = new TestPort();
    const transport = create(port as unknown as MessagePortMain);
    if (event === 'close') port.emit('close');
    else {
      port.failSend = true;
      expect(() => transport.send({})).toThrow(SecretBrokerError);
    }
    const seen: SecretBrokerTerminal[] = [];
    transport.subscribeTerminal(reason => seen.push(reason));
    expect(seen).toEqual([event === 'close' ? 'closed' : 'error']);
    port.emit('close');
    expect(seen.length).toBe(1);
    expect(() => transport.send({})).toThrow(SecretBrokerError);
    transport.close();
  });

  it('notifies each terminal owner once and supports explicit unsubscribe', () => {
    const port = new TestPort();
    const transport = create(port as unknown as MessagePortMain);
    let removed = 0;
    let remaining = 0;
    transport.subscribeTerminal(() => { throw new Error('Synthetic observer failure.'); });
    const unsubscribe = transport.subscribeTerminal(() => removed++);
    transport.subscribeTerminal(() => remaining++);
    unsubscribe();
    port.failSend = true;
    expect(() => transport.send({})).toThrow(SecretBrokerError);
    expect(removed).toBe(0);
    expect(remaining).toBe(1);
    transport.close();
    expect(remaining).toBe(1);
  });

  it('attempts every owned teardown and retains the first safe close error', () => {
    const port = new TestPort();
    const transport = create(port as unknown as MessagePortMain);
    transport.subscribe(() => {});
    port.failClose = true;
    port.failOff = true;
    let first: unknown;
    try { transport.close(); } catch (error) { first = error; }
    expect(first).toBeInstanceOf(SecretBrokerError);
    expect(() => transport.close()).toThrow(first as Error);
    expect(port.closeCount).toBe(1);
    expect(port.offCount).toBe(2);
    expect(port.eventNames().length).toBe(0);
  });

  it('cleans up a failed start and returns only a safe error', () => {
    const port = new TestPort();
    port.failStart = true;
    expect(() => create(port as unknown as MessagePortMain)).toThrow(SecretBrokerError);
    expect(port.closeCount).toBe(1);
    expect(port.eventNames().length).toBe(0);
  });

  it('does not return a raw port send exception', () => {
    const port = new TestPort();
    const transport = create(port as unknown as MessagePortMain);
    port.failSend = true;
    expect(() => transport.send({})).toThrow(SecretBrokerError);
    transport.close();
  });
});
