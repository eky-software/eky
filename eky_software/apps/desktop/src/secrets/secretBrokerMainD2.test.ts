import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';

import { EncryptedSecretFile, type EncryptedSecretFileStore } from './encryptedSecretFile.js';
import type { StringProtector } from './safeStorageStringProtector.js';
import { CompanyEmailSecretBrokerClient } from './secretBrokerClient.js';
import { SecretBrokerError } from './secretBrokerErrors.js';
import { handleSecretBrokerMessage, startSecretBrokerMain } from './secretBrokerMain.js';
import {
  createSecretBrokerRequest,
  parseSecretBrokerResponse,
  type SecretBrokerOperation,
  type SecretBrokerResponse,
} from './secretBrokerProtocol.js';
import { ControlledSecretTransport, createLinkedSecretTransports, createSecretGate } from './secretBrokerTestSupport.js';

const companyId = 'synthetic-company';
const previousSecret = 'synthetic-previous';
const nextSecret = 'synthetic-next';
const protector: StringProtector = {
  async encrypt(value) {
    return Uint8Array.from(Buffer.from(value), byte => byte ^ 0xa5);
  },
  async decrypt(bytes) {
    return { shouldReEncrypt: false,
      value: Buffer.from(Uint8Array.from(bytes, byte => byte ^ 0xa5)).toString() };
  },
};
type Phase = keyof EncryptedSecretFileStore | 'encrypt';

describe('D2 broker with real encrypted file bytes', () => {
  const disposeFixtures: Array<() => Promise<void>> = [];
  let now = 0;
  let captureOriginalException: (error: unknown) => void;
  beforeEach(context => {
    now = 0;
    let firstFailure: { error: unknown } | undefined;
    captureOriginalException = error => { firstFailure ??= { error }; };
    context.onTestFailed(async () => {
      if (firstFailure === undefined || context.task.fails) return;
      // Only this fixture's synthetic file operations are connected to the private sink.
      const sink = createRunnerFailureSink({ secrets: [previousSecret, nextSecret] });
      const task = context.task;
      const retryCount = task.result?.retryCount ?? 0;
      const repeatCount = task.result?.repeatCount ?? 0;
      sink.record({ runner: 'vitest', phase: 'd2BrokerCatch', error: firstFailure.error,
        testName: task.fullTestName, testId: task.id, file: task.file.filepath,
        ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
        retryCount, repeatCount,
        ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}),
      });
      await sink.flush();
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(async () => {
    for (const dispose of disposeFixtures.splice(0)) await dispose();
    vi.useRealTimers();
  });

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'eky-secret-broker-'));
    const path = join(root, 'company-email-smtp-v1.dat');
    const file = new EncryptedSecretFile(path);
    const generationId = randomUUID();
    const [clientTransport, mainTransport] = createLinkedSecretTransports();
    const flags = {
      failEncrypt: false, failDecrypt: false, failWriteBefore: false, failWriteAfter: false,
      failConfirmAfter: false, failRemoveAfter: false, partialRemove: false, reEncrypt: false,
    };
    const calls = { confirm: 0, readCandidate: 0, remove: 0, write: 0, encrypt: 0 };
    const holds = new Map<Phase, ReturnType<typeof hold>>();
    const releases: (() => void)[] = [];
    const work: Promise<unknown>[] = [];
    function hold(phase: Phase) {
      const gate = { entered: createSecretGate(), release: createSecretGate(), done: createSecretGate() };
      holds.set(phase, gate);
      releases.push(gate.release.resolve);
      return gate;
    }
    function run<T>(phase: Phase, action: () => Promise<T>): Promise<T> {
      const gate = holds.get(phase);
      holds.delete(phase);
      calls[phase]++;
      const task = (async () => {
        try {
          if (gate !== undefined) {
            gate.entered.resolve();
            await gate.release.promise;
          }
          return await action();
        } finally { gate?.done.resolve(); }
      })();
      work.push(task);
      return task;
    }
    const store: EncryptedSecretFileStore = {
      readCandidate: () => run('readCandidate', () => file.readCandidate()),
      confirm: candidate => run('confirm', async () => {
        await file.confirm(candidate);
        if (flags.failConfirmAfter) throw new Error('Synthetic confirmation failure.');
      }),
      write: bytes => run('write', async () => {
        if (flags.failWriteBefore) throw new SecretBrokerError('SECRET_WRITE_FAILED', 'noEffect');
        await file.write(bytes);
        if (flags.failWriteAfter) throw new Error('Synthetic post-publication failure.');
      }),
      remove: () => run('remove', async () => {
        if (flags.partialRemove) {
          await rm(path);
          throw new Error('Synthetic partial removal failure.');
        }
        await file.remove();
        if (flags.failRemoveAfter) throw new Error('Synthetic post-removal failure.');
      }),
    };
    const controlledProtector: StringProtector = {
      encrypt: value => run('encrypt', async () => {
        if (flags.failEncrypt) throw new Error('Synthetic encryption failure.');
        return protector.encrypt(value);
      }),
      async decrypt(bytes) {
        if (flags.failDecrypt) throw new Error('Synthetic decryption failure.');
        return { ...await protector.decrypt(bytes), shouldReEncrypt: flags.reEncrypt };
      },
    };
    const main = startSecretBrokerMain({
      generationId, encryptedSecretFile: store, protector: controlledProtector,
      transport: mainTransport, now: () => now,
      observer: { captureOriginalException, operationFailed() {} },
    });
    const request = (operation: SecretBrokerOperation, generation = generationId) => createSecretBrokerRequest({
      companyId, generationId: generation, requestId: randomUUID(), operation,
      ...(operation === 'setCompanyEmailSecret' ? { secret: nextSecret } : {}),
    });
    const submit = (operation: SecretBrokerOperation, generation = generationId) => {
      const message = request(operation, generation);
      return new Promise<SecretBrokerResponse>(resolve => {
        const unsubscribe = clientTransport.subscribe(value => {
          const response = parseSecretBrokerResponse(value);
          if (response?.requestId !== message.requestId) return;
          unsubscribe();
          resolve(response);
        });
        clientTransport.send(message);
      });
    };
    const result = {
      root, path, file, generationId, clientTransport, mainTransport, flags, calls, store, main, hold,
      request, submit, protector: controlledProtector,
      async seed(secret = previousSecret) {
        await file.write(await protector.encrypt(JSON.stringify({ companyId, formatVersion: 1, secret })));
      },
      async contains(secret: string) {
        const candidate = await file.readCandidate();
        if (candidate === null) return false;
        const payload: unknown = JSON.parse((await protector.decrypt(candidate.ciphertext)).value);
        return typeof payload === 'object' && payload !== null && 'secret' in payload && payload.secret === secret;
      },
      async dispose() {
        const drain = main.sealAndDrain().catch(() => undefined);
        for (const release of releases) release();
        await Promise.allSettled(work);
        now += 5_000;
        await vi.advanceTimersByTimeAsync(5_000);
        await drain;
        await main.close().catch(() => undefined);
        await Promise.allSettled(work);
        await rm(root, { recursive: true, force: true });
      },
    };
    disposeFixtures.push(result.dispose);
    return result;
  }

  it('retains normal set, has, read and remove through the client and actual file format', async () => {
    const f = await fixture();
    const client = new CompanyEmailSecretBrokerClient(f.clientTransport, { generationId: f.generationId, now: () => now });
    await client.setSecret({ companyId, secret: nextSecret });
    const bytes = await readFile(f.path);
    expect(bytes.includes(Buffer.from(nextSecret))).toBe(false);
    expect(JSON.parse(bytes.toString()).formatVersion).toBe(1);
    expect(await client.hasSecret(companyId)).toBe(true);
    expect(await client.getSecret(companyId) === nextSecret).toBe(true);
    await client.removeSecret(companyId);
    expect(await client.hasSecret(companyId)).toBe(false);
    expect(await client.getSecret(companyId) === null).toBe(true);
    await missing(f.path);
    client.assertSettled();
    await f.main.sealAndDrain();
    client.close();
    await f.main.close();
  });

  it.each(['encrypt', 'decrypt'] as const)('classifies %s failure before any mutating call as noEffect with identical bytes', async phase => {
    const f = await fixture();
    await f.seed();
    const before = await readFile(f.path);
    await writeFile(`${f.path}.backup`, before);
    f.flags.failEncrypt = phase === 'encrypt';
    f.flags.failDecrypt = phase === 'decrypt';
    const response = await f.submit(phase === 'encrypt' ? 'setCompanyEmailSecret' : 'removeCompanyEmailSecret');
    expect(safeOutcome(response)).toEqual({ ok: false, effect: 'noEffect', code: 'SECRET_STORAGE_UNAVAILABLE' });
    expect((await readFile(f.path)).equals(before)).toBe(true);
    expect((await readFile(`${f.path}.backup`)).equals(before)).toBe(true);
    expect(f.calls.write + f.calls.confirm + f.calls.remove).toBe(0);
    expect(f.main.hasFailedMutation()).toBe(true);
    await f.main.sealAndDrain();
    expect(f.mainTransport.closeCount).toBe(0);
  });

  it.each(['setCompanyEmailSecret', 'removeCompanyEmailSecret'] as const)(
    'clears the obsolete noEffect notice only after a new explicit successful %s', async operation => {
      const f = await fixture();
      await f.seed();
      f.flags.failEncrypt = operation === 'setCompanyEmailSecret';
      f.flags.failDecrypt = operation === 'removeCompanyEmailSecret';
      expect(safeOutcome(await f.submit(operation)).effect).toBe('noEffect');
      expect(f.main.hasFailedMutation()).toBe(true);
      f.flags.failEncrypt = false;
      f.flags.failDecrypt = false;
      expect((await f.submit('hasCompanyEmailSecret')).ok).toBe(true);
      expect(f.main.hasFailedMutation()).toBe(true);
      expect((await f.submit(operation)).ok).toBe(true);
      expect(f.main.hasFailedMutation()).toBe(false);
      await f.main.sealAndDrain();
      expect(await f.contains(nextSecret)).toBe(operation === 'setCompanyEmailSecret');
    },
  );

  it.each(['failWriteBefore', 'failWriteAfter'] as const)('classifies %s as unknown once the mutating method is entered', async flag => {
    const f = await fixture();
    await f.seed();
    const before = await readFile(f.path);
    f.flags[flag] = true;
    const response = await f.submit('setCompanyEmailSecret');
    expect(safeOutcome(response).effect).toBe('unknown');
    expect((await readFile(f.path)).equals(before)).toBe(flag === 'failWriteBefore');
    expect(await f.contains(flag === 'failWriteBefore' ? previousSecret : nextSecret)).toBe(true);
    expect(f.main.hasFailedMutation()).toBe(false);
    await expect(f.main.sealAndDrain()).rejects.toBeInstanceOf(SecretBrokerError);
  });

  it('classifies a partial remove as unknown and records the actual remaining recovery bytes', async () => {
    const f = await fixture();
    await f.seed();
    const gate = f.hold('remove');
    f.flags.partialRemove = true;
    const response = f.submit('removeCompanyEmailSecret');
    await gate.entered.promise;
    const before = await readFile(f.path);
    await writeFile(`${f.path}.backup`, before);
    gate.release.resolve();
    expect(safeOutcome(await response).effect).toBe('unknown');
    await missing(f.path);
    expect((await readFile(`${f.path}.backup`)).equals(before)).toBe(true);
    await expect(f.main.sealAndDrain()).rejects.toBeInstanceOf(SecretBrokerError);
  });

  it.each(['hasCompanyEmailSecret', 'readCompanyEmailSecret'] as const)('drains recovery mutation performed by %s and keeps transport alive', async operation => {
    const f = await fixture();
    await f.seed();
    const before = await readFile(f.path);
    await rename(f.path, `${f.path}.backup`);
    const gate = f.hold('confirm');
    const response = f.submit(operation);
    await gate.entered.promise;
    let drained = false;
    const drain = f.main.sealAndDrain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    await missing(f.path);
    gate.release.resolve();
    expect((await response).ok).toBe(true);
    await drain;
    expect((await readFile(f.path)).equals(before)).toBe(true);
    await missing(`${f.path}.backup`);
    expect(f.mainTransport.closeCount).toBe(0);
  });

  it.each(['confirm', 'reencrypt'] as const)('treats failure after %s as unknown even on a presence check', async phase => {
    const f = await fixture();
    await f.seed();
    const before = await readFile(f.path);
    await rename(f.path, `${f.path}.backup`);
    f.flags.failConfirmAfter = phase === 'confirm';
    f.flags.reEncrypt = phase === 'reencrypt';
    f.flags.failEncrypt = phase === 'reencrypt';
    expect(safeOutcome(await f.submit('hasCompanyEmailSecret')).effect).toBe('unknown');
    expect((await readFile(f.path)).equals(before)).toBe(true);
    await missing(`${f.path}.backup`);
    await expect(f.main.sealAndDrain()).rejects.toBeInstanceOf(SecretBrokerError);
  });

  it('waits for re-encryption publication instead of draining after confirmation', async () => {
    const f = await fixture();
    await f.seed();
    f.flags.reEncrypt = true;
    const gate = f.hold('write');
    const response = f.submit('hasCompanyEmailSecret');
    await gate.entered.promise;
    let drained = false;
    const drain = f.main.sealAndDrain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    gate.release.resolve();
    expect((await response).ok).toBe(true);
    await drain;
    expect(await f.contains(previousSecret)).toBe(true);
    expect(f.calls.confirm).toBe(1);
    expect(f.calls.write).toBe(1);
  });

  it('rejects all unstarted and newly arriving work immediately on seal', async () => {
    const f = await fixture();
    const first = f.submit('setCompanyEmailSecret');
    const second = f.submit('removeCompanyEmailSecret');
    const drain = f.main.sealAndDrain();
    expect(safeOutcome(await first).effect).toBe('noEffect');
    expect(safeOutcome(await second).effect).toBe('noEffect');
    expect(safeOutcome(await f.submit('hasCompanyEmailSecret')).effect).toBe('noEffect');
    await drain;
    expect(Object.values(f.calls).every(count => count === 0)).toBe(true);
    expect(f.main.hasFailedMutation()).toBe(true);
    await missing(f.path);
  });

  it('serializes requests arriving directly at main before any seal', async () => {
    const f = await fixture();
    const gate = f.hold('write');
    const first = f.submit('setCompanyEmailSecret');
    await gate.entered.promise;
    const second = f.submit('setCompanyEmailSecret');
    await Promise.resolve();
    expect(f.calls.write).toBe(1);
    gate.release.resolve();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(f.calls.write).toBe(2);
    expect(await f.contains(nextSecret)).toBe(true);
  });

  it.each(['setCompanyEmailSecret', 'removeCompanyEmailSecret'] as const)('serializes active %s and rejects queued work while draining', async operation => {
    const f = await fixture();
    await f.seed();
    const gate = f.hold(operation === 'setCompanyEmailSecret' ? 'write' : 'remove');
    const active = f.submit(operation);
    await gate.entered.promise;
    const queued = f.submit('setCompanyEmailSecret');
    const drain = f.main.sealAndDrain();
    expect(safeOutcome(await queued).effect).toBe('noEffect');
    gate.release.resolve();
    expect((await active).ok).toBe(true);
    await drain;
    expect(f.calls.write).toBe(operation === 'setCompanyEmailSecret' ? 1 : 0);
    if (operation === 'setCompanyEmailSecret') expect(await f.contains(nextSecret)).toBe(true);
    else await missing(f.path);
  });

  it.each([4_999, 5_000])('checks the first monotonic drain deadline at %i even with a late timer', async at => {
    const f = await fixture();
    const gate = f.hold('write');
    const active = f.submit('setCompanyEmailSecret');
    await gate.entered.promise;
    const drain = f.main.sealAndDrain();
    const outcome = observed(drain);
    now = 4_000;
    expect(f.main.sealAndDrain()).toBe(drain);
    now = at;
    gate.release.resolve();
    expect((await active).ok).toBe(true);
    expect((await outcome).ok).toBe(at < 5_000);
    expect(await f.contains(nextSecret)).toBe(true);
    expect(f.mainTransport.closeCount).toBe(0);
  });

  it('does not resurrect an expired drain after a late write and preserves repeated close failure', async () => {
    const f = await fixture();
    const gate = f.hold('write');
    const active = f.submit('setCompanyEmailSecret');
    await gate.entered.promise;
    const drain = f.main.sealAndDrain();
    const result = observed(drain);
    now = 5_000;
    vi.advanceTimersByTime(5_000);
    expect(await result).toMatchObject({ ok: false, error: { code: 'SECRET_BROKER_DRAIN_TIMEOUT' } });
    await missing(f.path);
    gate.release.resolve();
    expect((await active).ok).toBe(true);
    expect(await f.contains(nextSecret)).toBe(true);
    expect(f.main.sealAndDrain()).toBe(drain);
    const close = f.main.close();
    const first = await observed(close);
    expect(f.main.close()).toBe(close);
    expect(await observed(f.main.close())).toEqual(first);
    expect(first.ok).toBe(false);
    expect(f.mainTransport.closeCount).toBe(1);
  });

  it('attempts final close at the deadline even while the underlying write has not finished', async () => {
    const f = await fixture();
    const gate = f.hold('write');
    f.clientTransport.send(f.request('setCompanyEmailSecret'));
    await gate.entered.promise;
    const close = f.main.close();
    const outcome = observed(close);
    now = 4_999;
    vi.advanceTimersByTime(4_999);
    expect(f.mainTransport.closeCount).toBe(0);
    expect(f.main.close()).toBe(close);
    now = 5_000;
    vi.advanceTimersByTime(1);
    expect(await outcome).toMatchObject({ ok: false, error: { code: 'SECRET_BROKER_DRAIN_TIMEOUT' } });
    expect(f.mainTransport.closeCount).toBe(1);
    expect(f.mainTransport.unsubscribeCount).toBe(2);
    await missing(f.path);
    gate.release.resolve();
    await gate.done.promise;
    expect(await f.contains(nextSecret)).toBe(true);
    expect(f.main.close()).toBe(close);
    expect((await observed(f.main.close())).ok).toBe(false);
  });

  it('re-arms early timer delivery against the same monotonic deadline', async () => {
    const f = await fixture();
    const gate = f.hold('write');
    f.clientTransport.send(f.request('setCompanyEmailSecret'));
    await gate.entered.promise;
    const drain = observed(f.main.sealAndDrain());
    now = 4_999;
    vi.advanceTimersByTime(5_000);
    expect(vi.getTimerCount()).toBe(1);
    now = 5_000;
    vi.advanceTimersByTime(1);
    expect(await drain).toMatchObject({ ok: false, error: { code: 'SECRET_BROKER_DRAIN_TIMEOUT' } });
    gate.release.resolve();
    await gate.done.promise;
  });

  it('fences a lost response before callers settle despite successful main publication', async () => {
    const f = await fixture();
    const sent = createSecretGate();
    f.mainTransport.beforeSend = () => { sent.resolve(); return false; };
    const client = new CompanyEmailSecretBrokerClient(f.clientTransport, { generationId: f.generationId, now: () => now });
    const active = observed(client.setSecret({ companyId, secret: nextSecret }));
    const queued = observed(client.removeSecret(companyId));
    await sent.promise;
    expect(await f.contains(nextSecret)).toBe(true);
    now = 10_000;
    vi.advanceTimersByTime(10_000);
    expect(await active).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    expect(await queued).toMatchObject({ ok: false, error: { effect: 'noEffect' } });
    expect(() => client.assertSettled()).toThrow(SecretBrokerError);
    expect(f.calls.remove).toBe(0);
    await expect(f.main.sealAndDrain()).rejects.toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
  });

  it('keeps client and main uncertain after a timed-out write later publishes actual bytes', async () => {
    const f = await fixture();
    const client = new CompanyEmailSecretBrokerClient(f.clientTransport, { generationId: f.generationId, now: () => now });
    const gate = f.hold('write');
    const active = observed(client.setSecret({ companyId, secret: nextSecret }));
    const queued = observed(client.removeSecret(companyId));
    await gate.entered.promise;
    now = 10_000;
    vi.advanceTimersByTime(10_000);
    expect(await active).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    expect(await queued).toMatchObject({ ok: false, error: { effect: 'noEffect' } });
    await missing(f.path);
    const drain = observed(f.main.sealAndDrain());
    gate.release.resolve();
    expect((await drain).ok).toBe(false);
    expect(await f.contains(nextSecret)).toBe(true);
    expect(f.calls.remove).toBe(0);
    client.close();
    expect(() => client.assertSettled()).toThrow(SecretBrokerError);
    expect(await observed(client.removeSecret(companyId))).toMatchObject({ ok: false, error: { effect: 'noEffect' } });
  });

  it('isolates two stores with identical company ids and rejects cross-generation work', async () => {
    const a = await fixture();
    const b = await fixture();
    await a.seed();
    await b.seed('synthetic-other-workspace');
    const bBefore = await readFile(b.path);
    expect(safeOutcome(await b.submit('setCompanyEmailSecret', a.generationId)).effect).toBe('noEffect');
    expect(b.calls.write).toBe(0);
    expect(b.main.hasFailedMutation()).toBe(false);
    const gate = a.hold('write');
    const active = a.submit('setCompanyEmailSecret');
    await gate.entered.promise;
    const drain = observed(a.main.sealAndDrain());
    now = 5_000;
    vi.advanceTimersByTime(5_000);
    expect((await drain).ok).toBe(false);
    gate.release.resolve();
    await active;
    expect(await a.contains(nextSecret)).toBe(true);
    expect((await readFile(b.path)).equals(bBefore)).toBe(true);
    expect(await b.contains('synthetic-other-workspace')).toBe(true);
    // Store isolation does not authorize activation after the other drain failed.
  });

  it('keeps transport send failure sticky and prevents queued store calls', async () => {
    const f = await fixture();
    const gate = f.hold('write');
    f.clientTransport.send(f.request('setCompanyEmailSecret'));
    await gate.entered.promise;
    f.clientTransport.send(f.request('removeCompanyEmailSecret'));
    const attempted = createSecretGate();
    f.mainTransport.beforeSend = () => { attempted.resolve(); throw new Error('Synthetic send failure.'); };
    gate.release.resolve();
    await attempted.promise;
    await expect(f.main.sealAndDrain()).rejects.toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    expect(await f.contains(nextSecret)).toBe(true);
    expect(f.calls.remove).toBe(0);
  });

  it.each(['closed', 'error'] as const)('rejects a terminal %s during active work without pretending it stopped', async reason => {
    const f = await fixture();
    const gate = f.hold('write');
    f.clientTransport.send(f.request('setCompanyEmailSecret'));
    await gate.entered.promise;
    f.mainTransport.terminate(reason);
    const drain = observed(f.main.sealAndDrain());
    await missing(f.path);
    gate.release.resolve();
    expect(await drain).toMatchObject({ ok: false, error: { code: 'SECRET_BROKER_TRANSPORT_FAILED' } });
    expect(await f.contains(nextSecret)).toBe(true);
  });

  it('attempts all final teardown, shares close, and preserves its failure', async () => {
    const f = await fixture();
    f.mainTransport.failUnsubscribe = true;
    f.mainTransport.failClose = true;
    const first = f.main.close();
    expect(f.main.close()).toBe(first);
    expect(await observed(first)).toMatchObject({ ok: false, error: { code: 'SECRET_BROKER_TRANSPORT_FAILED' } });
    expect(f.main.close()).toBe(first);
    expect(f.mainTransport.unsubscribeCount).toBe(2);
    expect(f.mainTransport.closeCount).toBe(1);
  });

  it('cannot settle a reentrant seal before the final queued rejection send fails', async () => {
    const f = await fixture();
    f.clientTransport.send(f.request('setCompanyEmailSecret'));
    f.clientTransport.send(f.request('removeCompanyEmailSecret'));
    let reentered: Promise<void> | undefined;
    let count = 0;
    f.mainTransport.beforeSend = () => {
      count++;
      if (count === 1) reentered = f.main.close();
      else throw new Error('Synthetic final rejection send failure.');
      return true;
    };
    const drain = observed(f.main.sealAndDrain());
    expect((await drain).ok).toBe(false);
    expect(reentered).toBe(f.main.close());
    expect((await observed(f.main.close())).ok).toBe(false);
    expect(f.calls.write + f.calls.remove).toBe(0);
    expect(f.mainTransport.closeCount).toBe(1);
  });

  it.each(['before-seal', 'after-seal', 'error-after-seal'] as const)('handles idle terminal observation %s', async timing => {
    const f = await fixture();
    if (timing !== 'before-seal') await f.main.sealAndDrain();
    f.mainTransport.terminate(timing === 'error-after-seal' ? 'error' : 'closed');
    expect((await observed(f.main.close())).ok).toBe(timing === 'after-seal');
  });

  it('requires injected main generation and cleans up partial subscription acquisition', async () => {
    const f = await fixture();
    const transport = new ControlledSecretTransport();
    expect(() => startSecretBrokerMain({
      encryptedSecretFile: f.file, generationId: '', protector, transport,
    })).toThrow(SecretBrokerError);
    expect(transport.listeners.size).toBe(0);
    transport.subscribeTerminal = () => { throw new Error('Synthetic subscription failure.'); };
    const main = startSecretBrokerMain({
      encryptedSecretFile: f.file, generationId: randomUUID(), protector, transport,
    });
    expect((await observed(main.close())).ok).toBe(false);
    expect(transport.unsubscribeCount).toBe(1);
    expect(transport.closeCount).toBe(1);
    expect(transport.listeners.size).toBe(0);
  });

  it('does not let observer failure change a proven pre-mutation outcome', async () => {
    const f = await fixture();
    f.flags.failEncrypt = true;
    const response = await handleSecretBrokerMessage(f.request('setCompanyEmailSecret'), {
      generationId: f.generationId, encryptedSecretFile: f.store, protector: f.protector,
      observer: { operationFailed() { throw new Error('Synthetic observer failure.'); } },
    });
    expect(safeOutcome(response).effect).toBe('noEffect');
    expect(f.calls.write).toBe(0);
  });
});

function safeOutcome(response: SecretBrokerResponse | undefined) {
  return { ok: response?.ok,
    effect: response?.ok === false ? response.effect : undefined,
    code: response?.ok === false ? response.errorCode : undefined };
}

function observed(promise: Promise<void>) {
  return promise.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
}

async function missing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
}
