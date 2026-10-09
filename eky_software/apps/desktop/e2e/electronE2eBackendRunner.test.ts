import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ acquire: vi.fn(), assertOwned: vi.fn() }));
vi.mock('../src/runtime/workspaceProcessReservation.js', () => ({
  acquireWorkspaceProcessReservation: runtime.acquire,
}));

const originalParentPort = Object.getOwnPropertyDescriptor(process, 'parentPort');
const descriptor = {
  generationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  identity: 'a'.repeat(64), userDataRoot: resolve('synthetic-test-root'),
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('EKY_E2E', '1');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (originalParentPort === undefined) Reflect.deleteProperty(process, 'parentPort');
  else Object.defineProperty(process, 'parentPort', originalParentPort);
});

async function fixture() {
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const invalidation = new AbortController();
  runtime.acquire.mockResolvedValue({
    assertOwned: runtime.assertOwned, invalidated: invalidation.signal,
  });
  runtime.assertOwned.mockResolvedValue(undefined);
  Object.defineProperty(process, 'parentPort', { value: parent, configurable: true });
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  await import('./electronE2eBackendRunner.js');
  return {
    parent, invalidation, exit,
    send(data: unknown) { parent.emit('message', { data, ports: [] }); },
    async flush() { await vi.advanceTimersByTimeAsync(0); },
  };
}

describe('Electron development child reservation boundary', () => {
  it('holds preparation until actual ownership is checked, then accepts the current grant envelope', async () => {
    const f = await fixture();
    let resolveCheck!: () => void;
    runtime.assertOwned.mockImplementationOnce(() => new Promise<void>(resolveGate => { resolveCheck = resolveGate; }));
    f.send({ type: 'prepare', reservation: descriptor });
    await f.flush();
    expect(runtime.acquire).toHaveBeenCalledWith({
      userDataRoot: descriptor.userDataRoot, expectedIdentity: descriptor.identity,
      signal: expect.any(AbortSignal),
    });
    expect(f.parent.postMessage).not.toHaveBeenCalled();
    resolveCheck();
    await f.flush();
    expect(f.parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'reservationReady', reservation: descriptor });
    f.send(startCommand(descriptor.generationId));
    await f.flush();
    // No broker ports in this contract fixture: reaching this stage proves parsing,
    // while the actual Electron scenario proves the import/start/success path.
    expect(f.parent.postMessage).toHaveBeenCalledWith({ type: 'progress', stage: 'boundaryValidation' });
    expect(f.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'failed', stage: 'boundaryValidation' }));
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['missingPrepare', 'wrongGeneration', 'oldEnvelope'] as const)('rejects %s before backend progress or import', async mode => {
    const f = await fixture();
    if (mode !== 'missingPrepare') {
      f.send({ type: 'prepare', reservation: descriptor });
      await f.flush();
    }
    const command = startCommand(mode === 'wrongGeneration' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : descriptor.generationId);
    if (mode === 'oldEnvelope') Reflect.deleteProperty(command, 'generationId');
    f.send(command);
    await f.flush();
    expect(f.parent.postMessage.mock.calls.some(([message]) => message.type === 'progress')).toBe(false);
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never reports reservation-ready after shutdown while acquisition is pending', async () => {
    const f = await fixture();
    let release!: () => void;
    runtime.acquire.mockImplementationOnce(() => new Promise(resolveGate => {
      release = () => resolveGate({ assertOwned: runtime.assertOwned, invalidated: f.invalidation.signal });
    }));
    f.send({ type: 'prepare', reservation: descriptor });
    await f.flush();
    f.send({ type: 'shutdown' });
    await f.flush();
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(0);
    release();
    await f.flush();
    expect(f.parent.postMessage.mock.calls.some(([message]) => message.type === 'reservationReady')).toBe(false);
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['lostReservation', 'orphanDeadline'] as const)('fails closed for %s before a grant', async mode => {
    const f = await fixture();
    f.send({ type: 'prepare', reservation: descriptor });
    await f.flush();
    if (mode === 'lostReservation') f.invalidation.abort();
    else await vi.advanceTimersByTimeAsync(30_000);
    await f.flush();
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'failed', stage: 'boundaryValidation' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['acquire', 'assertOwned'] as const)('exits on the pre-grant deadline without waiting for pending %s', async phase => {
    const f = await fixture();
    let release!: () => void;
    runtime[phase].mockImplementationOnce(() => new Promise(resolveGate => {
      release = () => resolveGate(phase === 'acquire'
        ? { assertOwned: runtime.assertOwned, invalidated: f.invalidation.signal }
        : undefined);
    }));
    f.send({ type: 'prepare', reservation: descriptor });
    await f.flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    release();
    await f.flush();
    expect(f.parent.postMessage.mock.calls.some(([message]) => message.type === 'reservationReady')).toBe(false);
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function startCommand(generationId: string) {
  const root = descriptor.userDataRoot;
  return {
    type: 'start', generationId, configPath: resolve(root, 'e2e-config.json'),
    config: {
      appVersion: '0.0.0-e2e', architecture: 'x64',
      buildCreatedAt: '2026-01-01T00:00:00.000Z', buildDirty: false, buildRevision: 'development',
      createSmokePdf: false, electronVersion: '43.7.6', migrationStartupPolicy: 'exactCurrentManifest',
      platform: 'win32', runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      runtimeSessionSecret: 'a'.repeat(43), verifySmokeSecretBroker: false,
      backendRoot: resolve(root, 'backend'), databaseFilePath: resolve(root, 'data', 'eky.sqlite'),
      invoiceDocumentStorageRoot: resolve(root, 'storage'), migrationsDirectory: resolve(root, 'migrations'),
      operationalLogsRoot: resolve(root, 'logs'), profileSnapshotStagingRoot: resolve(root, 'staging'),
      smokePdfPath: resolve(root, 'smoke', 'invoice.pdf'),
    },
  };
}
