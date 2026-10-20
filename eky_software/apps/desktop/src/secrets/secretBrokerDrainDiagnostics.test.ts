import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretBrokerError } from './secretBrokerErrors.js';
import { startSecretBrokerMain, type SecretBrokerMainHandle } from './secretBrokerMain.js';
import { createSecretBrokerRequest } from './secretBrokerProtocol.js';
import { ControlledSecretTransport, createSecretGate } from './secretBrokerTestSupport.js';

describe('secret broker drain diagnostics', () => {
  let now = 0;
  const handles: SecretBrokerMainHandle[] = [];
  const releases: Array<() => void> = [];

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    const closing = Promise.allSettled(handles.splice(0).map(handle => handle.close()));
    now += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    await closing;
    vi.useRealTimers();
  });

  function fixture() {
    const transport = new ControlledSecretTransport();
    const generationId = randomUUID();
    const completed = createSecretGate();
    transport.beforeSend = () => { completed.resolve(); return true; };
    const observer = {
      drainFailed: vi.fn<(errorCode: SecretBrokerError['code']) => void>(),
      operationFailed: vi.fn(),
    };
    const encryptedSecretFile = {
      confirm: vi.fn(async (): Promise<void> => undefined),
      readCandidate: vi.fn(async () => null),
      remove: vi.fn(async (): Promise<void> => undefined),
      write: vi.fn(async (): Promise<void> => undefined),
    };
    const protector = {
      encrypt: vi.fn(async () => Uint8Array.of(1)),
      decrypt: vi.fn(async () => { throw new Error('Synthetic unused decryption.'); }),
    };
    const main = startSecretBrokerMain({
      encryptedSecretFile, generationId, now: () => now, observer, protector, transport,
    });
    handles.push(main);
    return {
      main, transport, observer, encryptedSecretFile, protector, completed,
      submit() {
        transport.receive(createSecretBrokerRequest({
          companyId: 'synthetic-company', generationId,
          operation: 'setCompanyEmailSecret', requestId: randomUUID(),
          secret: 'synthetic-drain-test',
        }));
        return completed.promise;
      },
    };
  }

  it.each(['closed', 'error'] as const)(
    'defers an early transport %s notification until drain rejection and reports it once', async reason => {
      const f = fixture();
      f.transport.terminate(reason);
      expect(f.observer.drainFailed).not.toHaveBeenCalled();

      const drain = f.main.sealAndDrain();
      const failure = await drain.catch(error => error);
      expect(failure).toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED', effect: 'unknown' });
      expect(f.main.sealAndDrain()).toBe(drain);
      const closing = f.main.close();
      await expect(closing).rejects.toBe(failure);
      expect(f.main.close()).toBe(closing);
      expect(f.observer.drainFailed.mock.calls).toEqual([['SECRET_BROKER_TRANSPORT_FAILED']]);
      expect(f.observer.operationFailed).not.toHaveBeenCalled();
    },
  );

  it.each(['success', 'noEffect'] as const)('does not report a drain failure after a %s mutation', async outcome => {
    const f = fixture();
    if (outcome === 'noEffect') {
      f.protector.encrypt.mockRejectedValueOnce(new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE', 'noEffect'));
    }
    await f.submit();
    await f.main.sealAndDrain();
    await f.main.close();
    expect(f.observer.drainFailed).not.toHaveBeenCalled();
    expect(f.encryptedSecretFile.write).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
  });

  it('preserves the first uncertain mutation code when transport fails before drain', async () => {
    const f = fixture();
    f.encryptedSecretFile.write.mockRejectedValueOnce(new SecretBrokerError('SECRET_WRITE_FAILED'));
    await f.submit();
    f.transport.terminate('error');
    expect(f.observer.drainFailed).not.toHaveBeenCalled();

    await expect(f.main.sealAndDrain()).rejects.toMatchObject({ code: 'SECRET_WRITE_FAILED', effect: 'unknown' });
    expect(f.observer.drainFailed.mock.calls).toEqual([['SECRET_WRITE_FAILED']]);
    expect(f.observer.operationFailed.mock.calls).toEqual([['setCompanyEmailSecret', 'SECRET_WRITE_FAILED']]);
  });

  it('reports at 5000ms, not 4999ms, and never repeats or clears the failure after late completion', async () => {
    const f = fixture();
    const entered = createSecretGate();
    const release = createSecretGate();
    releases.push(release.resolve);
    f.encryptedSecretFile.write.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const completed = f.submit();
    await entered.promise;
    const drain = f.main.sealAndDrain();
    const rejected = drain.catch(error => error);
    now = 4_999;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(f.observer.drainFailed).not.toHaveBeenCalled();
    expect(f.main.sealAndDrain()).toBe(drain);
    now = 5_000;
    await vi.advanceTimersByTimeAsync(1);
    const failure = await rejected;
    expect(failure).toMatchObject({ code: 'SECRET_BROKER_DRAIN_TIMEOUT', effect: 'unknown' });
    expect(f.transport.closeCount).toBe(0);

    release.resolve();
    await completed;
    await expect(f.main.sealAndDrain()).rejects.toBe(failure);
    await expect(f.main.close()).rejects.toBe(failure);
    expect(f.observer.drainFailed.mock.calls).toEqual([['SECRET_BROKER_DRAIN_TIMEOUT']]);
  });

  it('keeps the shared rejection when the observer reenters close and throws', async () => {
    const f = fixture();
    let reentrantDrain: Promise<void> | undefined;
    let reentrantClose: Promise<void> | undefined;
    f.observer.drainFailed.mockImplementation(() => {
      reentrantDrain = f.main.sealAndDrain();
      reentrantClose = f.main.close();
      throw new Error('Synthetic observer failure.');
    });
    f.transport.terminate('error');
    const drain = f.main.sealAndDrain();
    const failure = await drain.catch(error => error);
    expect(failure).toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    expect(reentrantDrain).toBe(drain);
    expect(reentrantClose).toBe(f.main.close());
    await expect(reentrantClose).rejects.toBe(failure);
    expect(f.observer.drainFailed).toHaveBeenCalledOnce();
  });

  it.each(['rejected', 'pending'] as const)('does not wait for an asynchronously %s observer', async state => {
    const f = fixture();
    const release = createSecretGate();
    releases.push(release.resolve);
    f.observer.drainFailed.mockImplementation(async () => {
      if (state === 'rejected') throw new Error('Synthetic async observer failure.');
      await release.promise;
    });
    f.transport.terminate('error');
    await expect(f.main.sealAndDrain()).rejects.toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    await expect(f.main.close()).rejects.toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    expect(f.observer.drainFailed).toHaveBeenCalledOnce();
  });

  it('does not report teardown-only failure as a failed drain', async () => {
    const f = fixture();
    await f.main.sealAndDrain();
    f.transport.failClose = true;
    const closing = f.main.close();
    const failure = await closing.catch(error => error);
    expect(failure).toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    await expect(f.main.sealAndDrain()).resolves.toBeUndefined();
    await expect(f.main.close()).rejects.toBe(failure);
    expect(f.observer.drainFailed).not.toHaveBeenCalled();
  });
});
