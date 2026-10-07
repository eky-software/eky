import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import type { MessagePortMain } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDesktopBackend, type StartDesktopBackendOptions } from './backendProcess.js';

const boundary = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: boundary.fork } }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('backend process shutdown result', () => {
  it.each(['exited', 'forced'] as const)('preserves the observed %s outcome for its owner', async (outcome) => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const stopped = fixture.backend.stop();
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
    if (outcome === 'forced') {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(fixture.kill).toHaveBeenCalledOnce();
    }
    fixture.process.emit('exit', 0);

    await expect(stopped).resolves.toBe(outcome);
    expect(fixture.write.mock.calls.some(([event]) =>
      event.eventName === 'backendProcess.stopFailed',
    )).toBe(outcome === 'forced');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not acknowledge a forced stop without an observed exit', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const rejection = expect(fixture.backend.stop()).rejects.toThrow(
      'The backend did not exit after forced termination.',
    );
    await vi.advanceTimersByTimeAsync(6_000);
    await rejection;
    expect(fixture.kill).toHaveBeenCalledOnce();
  });

  it('keeps update shutdown strict without invoking the forced fallback', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const rejection = expect(fixture.backend.stopForUpdate()).rejects.toThrow(
      'The backend did not stop gracefully within the allowed time.',
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
    expect(fixture.kill).not.toHaveBeenCalled();
  });

  it('keeps successful update shutdown compatible', async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();
    const stopped = fixture.backend.stopForUpdate();
    fixture.process.emit('exit', 0);
    await expect(stopped).resolves.toBeUndefined();
    expect(fixture.kill).not.toHaveBeenCalled();
  });

  it.each(['stop', 'stopForUpdate'] as const)(
    'rejects an unsuccessful process exit during %s',
    async (method) => {
      vi.useFakeTimers();
      const fixture = await createFixture();
      const rejection = expect(fixture.backend[method]()).rejects.toThrow(
        'The backend exited unsuccessfully during shutdown.',
      );
      fixture.process.emit('exit', 1);
      await rejection;
      expect(fixture.kill).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe('backend migration gate private exception observation', () => {
  it.each([false, true])('preserves the original rejection before abort without leaking it (observer throws: %s)', async (observerThrows) => {
    vi.useFakeTimers();
    const original = new Error('synthetic private gate detail', { cause: new Error('synthetic inner cause') });
    const abortedAtObservation: boolean[] = [];
    const observeStartupException = vi.fn((_error: unknown) => {
      abortedAtObservation.push(fixture.postMessage.mock.calls.some(([message]) => message.type === 'abortStartup'));
      if (observerThrows) throw new Error('synthetic evidence failure');
    });
    const fixture = createStartingFixture({
      beforeMigrations: async () => { throw original; }, observeStartupException,
    });
    const rejected = fixture.started.then(() => undefined, (error: unknown) => error);
    fixture.process.emit('message', { type: 'migrationGateReady', inspection: {
      appliedMigrationCount: 38, migrationChainIdentity: 'b'.repeat(64),
      pendingMigrationCount: 1, profileState: 'existing',
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(observeStartupException).toHaveBeenCalledExactlyOnceWith(original);
    expect(abortedAtObservation).toEqual([false]);
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'abortStartup' });
    fixture.process.emit('message', { type: 'failed', code: 'BACKEND_MIGRATION_STARTUP_GATE_FAILED' });
    const result = await rejected;
    expect(result).toEqual(new Error('BACKEND_MIGRATION_STARTUP_GATE_FAILED'));
    expect(result).not.toHaveProperty('cause');
    expect(fixture.kill).toHaveBeenCalledOnce();
    expect(JSON.stringify(fixture.write.mock.calls)).not.toContain('synthetic private');
    expect(JSON.stringify(fixture.write.mock.calls)).not.toContain('synthetic inner');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes a rejection after the coordinator has already stopped the startup process', async () => {
    vi.useFakeTimers();
    const original = new Error('synthetic failure after requested shutdown');
    const observeStartupException = vi.fn();
    const fixture = createStartingFixture({
      async beforeMigrations(_inspection, control) {
        await control.stopStartupRuntime();
        throw original;
      },
      observeStartupException,
    });
    const result = fixture.started.then(() => undefined, (error: unknown) => error);
    fixture.process.emit('message', { type: 'migrationGateReady', inspection: {
      appliedMigrationCount: 38, migrationChainIdentity: 'b'.repeat(64),
      pendingMigrationCount: 1, profileState: 'existing',
    } });
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
    fixture.process.emit('exit', 0);
    expect(await result).toEqual(new Error('BACKEND_MIGRATION_STARTUP_GATE_FAILED'));
    expect(observeStartupException).toHaveBeenCalledExactlyOnceWith(original);
    expect(fixture.postMessage).not.toHaveBeenCalledWith({ type: 'abortStartup' });
    expect(fixture.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not invoke private observation on a successful migration decision', async () => {
    vi.useFakeTimers();
    const observeStartupException = vi.fn();
    const fixture = createStartingFixture({ observeStartupException });
    fixture.process.emit('message', { type: 'migrationGateReady', inspection: {
      appliedMigrationCount: 38, migrationChainIdentity: 'b'.repeat(64),
      pendingMigrationCount: 1, profileState: 'existing',
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.postMessage).toHaveBeenLastCalledWith({ type: 'continueStartup' });
    fixture.process.emit('message', { type: 'ready', port: 12345,
      smokePdfCreated: false, smokeSecretBrokerVerified: false });
    const backend = await fixture.started;
    const stopped = backend.stop();
    fixture.process.emit('exit', 0);
    await expect(stopped).resolves.toBe('exited');
    expect(observeStartupException).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function createFixture() {
  const fixture = createStartingFixture();
  fixture.process.emit('message', {
    type: 'ready', port: 12345, smokePdfCreated: false, smokeSecretBrokerVerified: false,
  });
  return { ...fixture, backend: await fixture.started };
}

function createStartingFixture(options: Partial<Pick<StartDesktopBackendOptions,
  'beforeMigrations' | 'observeStartupException'>> = {}) {
  const process = new EventEmitter();
  const postMessage = vi.fn();
  const kill = vi.fn(() => true);
  boundary.fork.mockReturnValue(Object.assign(process, { kill, postMessage }));
  const write = vi.fn();
  const root = resolve('synthetic-backend-process-test');
  const started = startDesktopBackend({
    beforeMigrations: async () => undefined,
    ...options,
    config: {
      appVersion: '0.2.81', architecture: 'x64', backendRoot: root,
      buildCreatedAt: '2026-10-04T10:00:00.000Z', buildDirty: false,
      buildRevision: 'a'.repeat(40), createSmokePdf: false,
      databaseFilePath: resolve(root, 'test.sqlite'), electronVersion: '43.7.6',
      invoiceDocumentStorageRoot: resolve(root, 'invoices'),
      migrationsDirectory: resolve(root, 'migrations'),
      migrationStartupPolicy: 'exactCurrentManifest',
      operationalLogsRoot: resolve(root, 'logs'), platform: 'win32',
      profileSnapshotStagingRoot: resolve(root, 'staging'),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      runtimeSessionSecret: 'a'.repeat(64),
      smokePdfPath: resolve(root, 'smoke.pdf'), verifySmokeSecretBroker: false,
    },
    invoicePdfArchiveBrokerPort: {} as MessagePortMain,
    operationalIdentity: {
      appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    operationalLogger: { write },
    profileSnapshotBrokerPort: {} as MessagePortMain,
    runnerPath: resolve(root, 'runner.js'),
    secretBrokerPort: {} as MessagePortMain,
  });
  process.emit('spawn');
  return { started, process, kill, postMessage, write };
}
