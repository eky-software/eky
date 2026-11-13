import { expect, it, vi } from 'vitest';

import type { DesktopBackendHandle, StartDesktopBackendOptions } from '../src/runtime/backendProcess.js';
import { observeSelectorTestBackend } from './electronSelectorTestBackend.js';
import { createTrackedBackendStarter as createActivationStarter } from './workspaceActivationMigrationProof.js';
import { createTrackedBackendStarter as createFirstStartStarter } from './workspaceFirstStartMigrationProof.js';

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, ipcMain: {},
  protocol: {}, session: {}, shell: {}, dialog: {}, utilityProcess: {}, MessageChannelMain: class {} }));

const operationId = '11111111-1111-4111-8111-111111111111';
const variants = ['selector', 'firstStart', 'activation'] as const;

it('observes selector readiness only after the held original start and handle retention', async () => {
  let observedState: unknown;
  const observeReady = vi.fn(() => { observedState = f.observer.snapshot(); });
  const f = fixture('selector', observeReady);
  let release!: (handle: DesktopBackendHandle) => void;
  const pending = new Promise<DesktopBackendHandle>(resolve => { release = resolve; });
  f.delegate.mockImplementationOnce(() => pending);
  const started = f.start();
  const settled = vi.fn();
  void started.then(settled, settled);
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.delegate).toHaveBeenCalledExactlyOnceWith(f.options);
    expect(f.delegate.mock.calls[0]![0]).toBe(f.options);
    expect(f.observer.snapshot()).toEqual({ starts: 1, running: false, port: undefined });
    expect(settled).not.toHaveBeenCalled();
    expect(observeReady).not.toHaveBeenCalled();
    release(f.originalHandle);
    const handle = await started;
    expect(observeReady).toHaveBeenCalledExactlyOnceWith();
    expect(observedState).toEqual({ starts: 1, running: true, port: f.originalHandle.port });
    expect(handle.port).toBe(f.originalHandle.port);
  } finally {
    release(f.originalHandle);
    await expect((await started).stop()).resolves.toBe('exited');
  }
  expect(f.isRunning()).toBe(false);
  expect(f.ordinaryStop).toHaveBeenCalledTimes(1);
  expect(observeReady).toHaveBeenCalledTimes(1);
});

it.each([new Error('SYNTHETIC_START_FAILED'), undefined])(
  'preserves the exact selector startup rejection without readiness: %j', async original => {
    const observeReady = vi.fn();
    const f = fixture('selector', observeReady);
    f.delegate.mockRejectedValueOnce(original);
    await expect(f.start()).rejects.toBe(original);
    expect(f.delegate.mock.calls[0]![0]).toBe(f.options);
    expect(observeReady).not.toHaveBeenCalled();
    expect(f.observer.snapshot()).toEqual({ starts: 1, running: false, port: undefined });
    expect(f.ordinaryStop).not.toHaveBeenCalled();
  },
);

it.each(['absent', 'throws'] as const)('keeps selector success and stop ownership when readiness observer %s', async mode => {
  const observeReady = vi.fn(() => { throw new Error('SYNTHETIC_OBSERVATION_FAILED'); });
  const f = fixture('selector', mode === 'absent' ? undefined : observeReady);
  const handle = await f.start();
  expect(f.isRunning()).toBe(true);
  expect(observeReady).toHaveBeenCalledTimes(mode === 'absent' ? 0 : 1);
  const original = new Error('SYNTHETIC_STOP_FAILED');
  f.ordinaryStop.mockRejectedValueOnce(original);
  await expect(handle.stop()).rejects.toBe(original);
  expect(f.isRunning()).toBe(true);
  await expect(handle.stop()).resolves.toBe('exited');
  expect(f.isRunning()).toBe(false);
  expect(f.ordinaryStop).toHaveBeenCalledTimes(2);
  expect(observeReady).toHaveBeenCalledTimes(mode === 'absent' ? 0 : 1);
});

it.for(variants)('forwards repeated running checks and the original owner rejection in %s', async variant => {
  const f = fixture(variant);
  const handle = await f.start();
  handle.assertRunning();
  handle.assertRunning();
  expect(f.assertRunning).toHaveBeenCalledTimes(2);
  const original = new Error('SYNTHETIC_BACKEND_NOT_RUNNING');
  f.assertRunning.mockImplementationOnce(() => { throw original; });
  expect(() => handle.assertRunning()).toThrow(original);
  expect(f.ordinaryStop).not.toHaveBeenCalled();
  await handle.stop();
});

it.for(variants)('forwards the exact delete operation and awaits its owner in %s', async variant => {
  const f = fixture(variant);
  const handle = await f.start();
  const stop = handle.stopForDelete(operationId);
  try {
    expect(f.stopForDelete).toHaveBeenCalledExactlyOnceWith(operationId);
    expect(f.isRunning()).toBe(true);
    f.release();
    await stop;
    expect(f.isRunning()).toBe(false);
    expect(f.ordinaryStop).not.toHaveBeenCalled();
  } finally { f.release(); await stop.catch(() => undefined); }
});

it.for(variants)('retains the original failed delete owner for cleanup in %s', async variant => {
  const f = fixture(variant);
  const handle = await f.start();
  const original = new Error('SYNTHETIC_DELETE_EXIT_UNPROVEN');
  f.stopForDelete.mockRejectedValueOnce(original);
  await expect(handle.stopForDelete(operationId)).rejects.toBe(original);
  expect(f.isRunning()).toBe(true);
  await expect(handle.stop()).resolves.toBe('exited');
  expect(f.isRunning()).toBe(false);
  expect(f.stopForDelete).toHaveBeenCalledExactlyOnceWith(operationId);
});

function fixture(variant: typeof variants[number], observeReady?: () => void) {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const stopForDelete = vi.fn(async (_operationId: string) => pending);
  const ordinaryStop = vi.fn(async () => 'exited' as const);
  const assertRunning = vi.fn();
  const originalHandle: DesktopBackendHandle = {
    assertRunning, port: 12345, onUnexpectedExit() {}, stop: ordinaryStop, stopForDelete,
    async stopForUpdate() {}, async stopForRestore() {},
  };
  const delegate = vi.fn(async (_options: StartDesktopBackendOptions): Promise<DesktopBackendHandle> => originalHandle);
  const tracker = { activeHandles: new Set<DesktopBackendHandle>(), startCount: 0,
    databaseStarts: [] as string[], relaunchCount: 0, successfulStartCount: 0,
    runtimeSessionCount: 0, selectorCleanupFailed: false };
  const observer = observeSelectorTestBackend(delegate, observeReady);
  const start = variant === 'selector' ? observer.startBackend
    : (variant === 'firstStart' ? createFirstStartStarter : createActivationStarter)({ delegate, tracker });
  const options = { config: { databaseFilePath: 'synthetic-unopened-database' } } as StartDesktopBackendOptions;
  return { start: () => start(options), release, stopForDelete, ordinaryStop, assertRunning,
    delegate, options, originalHandle, observer,
    isRunning: () => variant === 'selector' ? observer.snapshot().running : tracker.activeHandles.size !== 0 };
}
