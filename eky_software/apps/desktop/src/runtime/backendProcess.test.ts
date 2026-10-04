import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import type { MessagePortMain } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDesktopBackend } from './backendProcess.js';

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

async function createFixture() {
  const process = new EventEmitter();
  const postMessage = vi.fn();
  const kill = vi.fn(() => true);
  boundary.fork.mockReturnValue(Object.assign(process, { kill, postMessage }));
  const write = vi.fn();
  const root = resolve('synthetic-backend-process-test');
  const started = startDesktopBackend({
    beforeMigrations: async () => undefined,
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
  process.emit('message', {
    type: 'ready', port: 12345, smokePdfCreated: false, smokeSecretBrokerVerified: false,
  });
  return { backend: await started, process, kill, postMessage, write };
}
