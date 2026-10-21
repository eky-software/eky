import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopBackendStartupControl } from '../runtime/backendProcess.js';
import { SecretBrokerError } from '../secrets/secretBrokerErrors.js';
import { startSecretBrokerMain, type SecretBrokerMainHandle } from '../secrets/secretBrokerMain.js';
import { createSecretBrokerRequest } from '../secrets/secretBrokerProtocol.js';
import { ControlledSecretTransport, createSecretGate } from '../secrets/secretBrokerTestSupport.js';
import { createSecretSafeMigrationGate } from './secretSafeMigrationGate.js';

const inspection = {
  appliedMigrationCount: 1,
  migrationChainIdentity: 'a'.repeat(64),
  pendingMigrationCount: 1,
  profileState: 'existing' as const,
};

describe('secret-safe migration startup gate', () => {
  const brokers: SecretBrokerMainHandle[] = [];
  const releases: Array<() => void> = [];
  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    await Promise.allSettled(brokers.splice(0).map(broker => broker.close()));
  });

  function fixture() {
    const transport = new ControlledSecretTransport();
    const generationId = randomUUID();
    const store = {
      readCandidate: vi.fn(async () => null),
      confirm: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const drainFailed = vi.fn();
    const broker = startSecretBrokerMain({
      encryptedSecretFile: store,
      generationId,
      protector: {
        encrypt: async value => Buffer.from(value),
        decrypt: async bytes => ({ value: Buffer.from(bytes).toString(), shouldReEncrypt: false }),
      },
      transport,
      observer: { operationFailed() {}, drainFailed },
    });
    brokers.push(broker);
    const stopStartupRuntime = vi.fn(async () => { transport.terminate('closed'); });
    return { broker, drainFailed, generationId, store, transport, stopStartupRuntime };
  }

  it('seals before a controlled stop closes the real broker transport', async () => {
    const f = fixture();
    const gate = createSecretSafeMigrationGate(f.broker, async (received, control) => {
      expect(received).toBe(inspection);
      await control.stopStartupRuntime();
    });
    await gate(inspection, f);
    expect(f.stopStartupRuntime).toHaveBeenCalledOnce();
    await expect(f.broker.close()).resolves.toBeUndefined();
    expect(f.drainFailed).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'] as const)('seals before %s reaches the runtime abort and preserves the original error', async mode => {
    const f = fixture();
    const original = new Error('Synthetic migration failure.');
    const gate = createSecretSafeMigrationGate(f.broker, () => {
      if (mode === 'throw') throw original;
      return Promise.reject(original);
    });
    const aborted = gate(inspection, f).catch(error => {
      f.transport.terminate('closed');
      throw error;
    });
    await expect(aborted).rejects.toBe(original);
    await expect(f.broker.close()).resolves.toBeUndefined();
    expect(f.stopStartupRuntime).not.toHaveBeenCalled();
    expect(f.drainFailed).not.toHaveBeenCalled();
  });

  it.each(['stop', 'failure'] as const)('waits for active main work before %s, rejecting new admission during the wait', async mode => {
    const f = fixture();
    const entered = createSecretGate();
    const release = createSecretGate();
    releases.push(release.resolve);
    f.store.readCandidate.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    const request = () => createSecretBrokerRequest({
      companyId: 'synthetic-company', generationId: f.generationId,
      requestId: randomUUID(), operation: 'hasCompanyEmailSecret',
    });
    f.transport.receive(request());
    await entered.promise;
    const sealed = createSecretGate();
    const sealAndDrain = f.broker.sealAndDrain.bind(f.broker);
    vi.spyOn(f.broker, 'sealAndDrain').mockImplementation(() => {
      const drain = sealAndDrain();
      sealed.resolve();
      return drain;
    });
    const original = new Error('Synthetic migration failure.');
    const gate = createSecretSafeMigrationGate(f.broker, async (_received, control) => {
      if (mode === 'failure') throw original;
      await control.stopStartupRuntime();
    });
    let settled = false;
    const pending = gate(inspection, f).then(
      () => { settled = true; return undefined; },
      error => { settled = true; f.transport.terminate('closed'); return error; },
    );
    await sealed.promise;
    const denied = request();
    f.transport.receive(denied);
    expect(f.transport.messages).toContainEqual(expect.objectContaining({
      requestId: denied.requestId, ok: false, errorCode: 'SECRET_BROKER_GENERATION_CLOSED', effect: 'noEffect',
    }));
    expect(settled).toBe(false);
    expect(f.stopStartupRuntime).not.toHaveBeenCalled();
    release.resolve();
    expect(await pending).toBe(mode === 'failure' ? original : undefined);
    expect(f.store.readCandidate).toHaveBeenCalledOnce();
    await expect(f.broker.close()).resolves.toBeUndefined();
  });

  it('does not seal a successful callback that continues startup', async () => {
    const f = fixture();
    const sealAndDrain = vi.spyOn(f.broker, 'sealAndDrain');
    const gate = createSecretSafeMigrationGate(f.broker, async () => undefined);
    await gate(inspection, f);
    expect(sealAndDrain).not.toHaveBeenCalled();
    expect(f.stopStartupRuntime).not.toHaveBeenCalled();
  });

  it('retains the wrapped control when its owner uses it after the callback returns', async () => {
    const f = fixture();
    let retained!: DesktopBackendStartupControl;
    await createSecretSafeMigrationGate(f.broker, async (_received, control) => {
      retained = control;
    })(inspection, f);
    await retained.stopStartupRuntime();
    await expect(f.broker.close()).resolves.toBeUndefined();
    expect(f.stopStartupRuntime).toHaveBeenCalledOnce();
  });

  it('does not allow an unsolicited close or a failed drain to authorize controlled stop', async () => {
    const f = fixture();
    f.transport.terminate('closed');
    const gate = createSecretSafeMigrationGate(f.broker, async (_received, control) => {
      await control.stopStartupRuntime();
    });
    await expect(gate(inspection, f)).rejects.toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    expect(f.stopStartupRuntime).not.toHaveBeenCalled();
    await expect(f.broker.close()).rejects.toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    expect(f.drainFailed).toHaveBeenCalledExactlyOnceWith('SECRET_BROKER_TRANSPORT_FAILED');
  });

  it('keeps a failed drain separate from the original callback failure', async () => {
    const f = fixture();
    const original = new Error('Synthetic migration failure.');
    f.transport.terminate('error');
    await expect(createSecretSafeMigrationGate(f.broker, async () => {
      throw original;
    })(inspection, f)).rejects.toBe(original);
    await expect(f.broker.sealAndDrain()).rejects.toBeInstanceOf(SecretBrokerError);
    await expect(f.broker.close()).rejects.toMatchObject({ code: 'SECRET_BROKER_TRANSPORT_FAILED' });
    expect(f.stopStartupRuntime).not.toHaveBeenCalled();
  });
});
