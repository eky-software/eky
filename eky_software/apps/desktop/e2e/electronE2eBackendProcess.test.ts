import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import type { UtilityProcess } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StartDesktopBackendOptions } from '../src/runtime/backendProcess.js';
import type { ElectronE2eConfig } from './electronE2eConfig.js';
import { createElectronE2eBackendController } from './electronE2eBackendProcess.js';

afterEach(() => { vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() });
  const transfer = {
    descriptor: {
      generationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      identity: 'a'.repeat(64), userDataRoot: resolve('synthetic-test-root'),
    },
    prepare: vi.fn(async () => {}), assertGrant: vi.fn(async () => {}),
    assertCurrent: vi.fn(), reclaimAfterExit: vi.fn(async () => {}), invalidate: vi.fn(),
  };
  const controller = createElectronE2eBackendController({
    backend: { configPath: 'unused', port: 12345, sessionSecret: 'synthetic' },
  } as ElectronE2eConfig, 'unused-runner', {
    fork: vi.fn(() => child as unknown as UtilityProcess), observeStartup: vi.fn(),
  });
  const started = controller.startBackend({
    config: { runtimeSessionSecret: 'synthetic' }, reservationTransfer: transfer,
  } as unknown as StartDesktopBackendOptions);
  const observed = started.then(value => value, (error: unknown) => error);
  return {
    child, transfer, controller, started, observed,
    async prepare() {
      child.emit('spawn');
      await vi.advanceTimersByTimeAsync(0);
    },
    async grant() {
      child.emit('message', { type: 'reservationReady', reservation: transfer.descriptor });
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

describe('Electron development backend ownership boundary', () => {
  it('requires prepare and exact grant, keeps update shutdown unsupported, and reclaims only after exit', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.child.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'prepare', reservation: f.transfer.descriptor });
    await f.grant();
    expect(f.transfer.assertGrant).toHaveBeenCalledOnce();
    expect(f.transfer.assertCurrent).toHaveBeenCalledOnce();
    expect(f.child.postMessage).toHaveBeenLastCalledWith({
      config: { runtimeSessionSecret: 'synthetic' }, configPath: 'unused',
      generationId: f.transfer.descriptor.generationId, type: 'start',
    }, [undefined, undefined, undefined]);
    f.child.emit('message', { type: 'ready', port: 12345 });
    const handle = await f.started;
    await expect(handle.stopForUpdate('11111111-1111-4111-8111-111111111111'))
      .rejects.toThrow('ELECTRON_E2E_BACKEND_UPDATE_SHUTDOWN_UNSUPPORTED');
    expect(f.child.kill).not.toHaveBeenCalled();
    const stopping = handle.stop();
    expect(f.child.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
    expect(f.transfer.reclaimAfterExit).not.toHaveBeenCalled();
    f.child.emit('exit', 0);
    await expect(stopping).resolves.toBe('exited');
    expect(f.transfer.reclaimAfterExit).toHaveBeenCalledOnce();
    expect(f.transfer.invalidate).not.toHaveBeenCalled();
    expect(f.controller.isRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['prematureReady', 'wrongGeneration', 'grantFailure'] as const)('rejects %s before accepting startup', async failure => {
    const f = fixture();
    await f.prepare();
    if (failure === 'prematureReady') f.child.emit('message', { type: 'ready', port: 12345 });
    else if (failure === 'wrongGeneration') f.child.emit('message', {
      type: 'reservationReady', reservation: { ...f.transfer.descriptor, generationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });
    else {
      f.transfer.assertGrant.mockRejectedValueOnce(new Error('synthetic'));
      await f.grant();
    }
    expect(await f.observed).toMatchObject({ message: 'BACKEND_PROCESS_RESERVATION_FAILED' });
    expect(f.transfer.invalidate).toHaveBeenCalledOnce();
    expect(f.child.postMessage).toHaveBeenCalledTimes(1);
    expect(f.child.kill).toHaveBeenCalledOnce();
    f.child.emit('exit', 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['prepare', 'assertGrant'] as const)('never grants after the unchanged deadline interrupts %s', async phase => {
    const f = fixture();
    let release!: () => void;
    f.transfer[phase].mockImplementationOnce(() => new Promise<void>(resolveGate => { release = resolveGate; }));
    await f.prepare();
    if (phase === 'assertGrant') await f.grant();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await f.observed).toMatchObject({ message: 'DESKTOP_SMOKE_E2E_BACKEND_READY_TIMEOUT_FAILED' });
    const messageCount = f.child.postMessage.mock.calls.length;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.child.postMessage).toHaveBeenCalledTimes(messageCount);
    expect(f.transfer.assertCurrent).not.toHaveBeenCalled();
    expect(f.transfer.invalidate).toHaveBeenCalled();
    f.child.emit('exit', 1);
  });

  it.each(['failure', 'pending'] as const)('retains uncertainty when reclaim is %s', async mode => {
    const f = fixture();
    await f.prepare();
    await f.grant();
    f.child.emit('message', { type: 'ready', port: 12345 });
    const handle = await f.started;
    if (mode === 'failure') f.transfer.reclaimAfterExit.mockRejectedValueOnce(new Error('synthetic reclaim failure'));
    else f.transfer.reclaimAfterExit.mockImplementationOnce(() => new Promise<void>(() => {}));
    const stopping = handle.stop().then(() => undefined, (error: unknown) => error);
    f.child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await stopping).toBeInstanceOf(Error);
    expect(f.transfer.invalidate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reclaims after the existing forced-exit fallback without converting it to graceful exit', async () => {
    const f = fixture();
    await f.prepare();
    await f.grant();
    f.child.emit('message', { type: 'ready', port: 12345 });
    const handle = await f.started;
    f.child.kill.mockImplementation(() => { f.child.emit('exit', 1); return true; });
    const stopping = handle.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(stopping).resolves.toBe('forced');
    expect(f.transfer.reclaimAfterExit).toHaveBeenCalledOnce();
    expect(f.transfer.invalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
