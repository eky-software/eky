import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';

import type { MessagePortMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMainSecretBrokerTransport, createUtilitySecretBrokerTransport } from './electronSecretBrokerTransport.js';
import { EncryptedSecretFile, type EncryptedSecretFileStore } from './encryptedSecretFile.js';
import type { StringProtector } from './safeStorageStringProtector.js';
import { CompanyEmailSecretBrokerClient } from './secretBrokerClient.js';
import { SecretBrokerError } from './secretBrokerErrors.js';
import { startSecretBrokerMain } from './secretBrokerMain.js';
import { readSecretBrokerBinding } from './secretBrokerProtocol.js';
import { createSecretGate } from './secretBrokerTestSupport.js';

const companyId = 'synthetic-port-company';
const nextSecret = 'synthetic-port-next';
const protector: StringProtector = {
  async encrypt(value) { return Uint8Array.from(Buffer.from(value), byte => byte ^ 0xa5); },
  async decrypt(bytes) {
    return { shouldReEncrypt: false,
      value: Buffer.from(Uint8Array.from(bytes, byte => byte ^ 0xa5)).toString() };
  },
};

// Only the message event's envelope differs. Delivery, cloning and close are real Node ports.
// This is not proof of Electron utility-process startup or backend audit settlement.
class ElectronShapedNodePort extends EventEmitter {
  constructor(private readonly port: MessagePort) {
    super();
    port.on('message', data => this.emit('message', { data }));
    port.once('close', () => {
      this.emit('close');
      this.removeAllListeners();
    });
  }
  start(): void { this.port.start(); }
  close(): void { this.port.close(); }
  postMessage(value: unknown): void { this.port.postMessage(value); }
}

describe('secret broker through real MessageChannel delivery', () => {
  const disposeFixtures: Array<(preserve: boolean) => Promise<void>> = [];
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(async context => {
    const errors: unknown[] = [];
    try {
      for (const dispose of disposeFixtures.splice(0)) {
        try { await dispose(context.task.result?.state !== 'pass'); }
        catch (error) { errors.push(error); }
      }
    } finally { vi.useRealTimers(); }
    if (errors.length > 0) throw new AggregateError(errors, 'Synthetic port cleanup failed.');
  });

  async function fixture(operation: 'set' | 'remove', holdMutation = false) {
    const root = await mkdtemp(join(tmpdir(), 'eky-secret-port-'));
    const path = join(root, 'company-email-smtp-v1.dat');
    const file = new EncryptedSecretFile(path);
    await file.write(await protector.encrypt(JSON.stringify({
      companyId, formatVersion: 1, secret: 'synthetic-port-previous',
    })));
    const before = await readFile(path);
    const generationId = randomUUID();
    const operationId = randomUUID();
    const channel = new MessageChannel();
    const closed = Promise.all([channel.port1, channel.port2].map(
      port => new Promise<void>(resolve => port.once('close', resolve)),
    ));
    const clientTransport = createUtilitySecretBrokerTransport(
      new ElectronShapedNodePort(channel.port1) as unknown as MessagePortMain,
    );
    const mainTransport = createMainSecretBrokerTransport(
      new ElectronShapedNodePort(channel.port2) as unknown as MessagePortMain,
    );
    const mutation = { entered: createSecretGate(), release: createSecretGate() };
    const work: Promise<void>[] = [];
    let mutationCount = 0;
    const runMutation = (action: () => Promise<void>) => {
      mutationCount++;
      const task = (async () => {
        mutation.entered.resolve();
        if (holdMutation) await mutation.release.promise;
        await action();
      })();
      work.push(task);
      return task;
    };
    const store: EncryptedSecretFileStore = {
      readCandidate: () => file.readCandidate(),
      confirm: candidate => file.confirm(candidate),
      write: bytes => runMutation(() => file.write(bytes)),
      remove: () => runMutation(() => file.remove()),
    };
    const replyAttempted = createSecretGate();
    let holdReplies = false;
    const heldReplies: unknown[] = [];
    const send = mainTransport.send.bind(mainTransport);
    mainTransport.send = value => {
      replyAttempted.resolve();
      if (holdReplies) heldReplies.push(value);
      else send(value);
    };
    let receivedRequestId: string | undefined;
    const unsubscribeObservation = mainTransport.subscribe(value => {
      receivedRequestId = readSecretBrokerBinding(value)?.requestId;
    });
    const main = startSecretBrokerMain({ generationId, encryptedSecretFile: store,
      protector, transport: mainTransport, now: () => now });
    const client = new CompanyEmailSecretBrokerClient(clientTransport, { generationId, now: () => now });
    disposeFixtures.push(async preserve => {
      mutation.release.resolve();
      const drain = main.sealAndDrain().catch(() => undefined);
      await Promise.allSettled(work);
      now += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      await drain;
      unsubscribeObservation();
      try { client.close(); } catch { /* Test assertions own any expected failure. */ }
      await main.close().catch(() => undefined);
      await closed;
      await Promise.allSettled(work);
      if (!preserve) await rm(root, { recursive: true, force: true });
    });
    return {
      client, main, closed, mutation, replyAttempted, operationId,
      receivedRequestId: () => receivedRequestId,
      mutationCount: () => mutationCount,
      holdReplies() { holdReplies = true; },
      releaseReplies() {
        holdReplies = false;
        for (const reply of heldReplies.splice(0)) send(reply);
      },
      mutate: () => operation === 'set'
        ? client.setSecret({ companyId, secret: nextSecret, operationId })
        : client.removeSecret(companyId, operationId),
      async assertActualBytes() {
        if (operation === 'remove') {
          await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
          return;
        }
        const after = await readFile(path);
        expect(after.equals(before)).toBe(false);
        expect(after.includes(Buffer.from(nextSecret))).toBe(false);
        const candidate = await file.readCandidate();
        if (candidate === null) throw new Error('Synthetic encrypted file missing.');
        const value: unknown = JSON.parse((await protector.decrypt(candidate.ciphertext)).value);
        expect(typeof value === 'object' && value !== null && 'secret' in value && value.secret === nextSecret).toBe(true);
      },
    };
  }

  it.each(['set', 'remove'] as const)('drains delayed %s and delivers the bound receipt before final port close', async operation => {
    const f = await fixture(operation, true);
    const pending = f.mutate();
    await f.mutation.entered.promise;
    expect(f.receivedRequestId()).toBe(f.operationId);
    const drain = f.main.sealAndDrain();
    now = 4_999;
    f.mutation.release.resolve();
    await drain;
    await pending;
    await f.assertActualBytes();
    f.client.assertSettled();
    f.client.close();
    await f.closed;
    await f.main.close();
  });

  it.each(['set', 'remove'] as const)('accepts delayed %s reply through the real port within the original budget', async operation => {
    const f = await fixture(operation);
    f.holdReplies();
    const pending = f.mutate();
    await f.replyAttempted.promise;
    expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
    await f.assertActualBytes();
    now = 9_999;
    f.releaseReplies();
    await pending;
    f.client.assertSettled();
    await f.main.sealAndDrain();
  });

  it.each(['set', 'remove'] as const)('fences a lost %s reply, queued work and late receipt after native port termination', async operation => {
    const f = await fixture(operation);
    f.holdReplies();
    const active = observed(f.mutate());
    const queued = observed(f.client.hasSecret(companyId));
    await f.replyAttempted.promise;
    await f.assertActualBytes();
    now = 10_000;
    vi.advanceTimersByTime(10_000);
    expect(await active).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    expect(await queued).toMatchObject({ ok: false, error: { effect: 'noEffect' } });
    await f.closed;
    expect(() => f.releaseReplies()).toThrow(SecretBrokerError);
    expect(() => f.client.assertSettled()).toThrow(SecretBrokerError);
    expect(f.mutationCount()).toBe(1);
    expect(await observed(f.main.sealAndDrain())).toMatchObject({ ok: false, error: { code: 'SECRET_BROKER_TRANSPORT_FAILED' } });
    const close = f.main.close();
    expect((await observed(close)).ok).toBe(false);
    expect(f.main.close()).toBe(close);
  });
});

function observed(promise: Promise<unknown>) {
  return promise.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
}
