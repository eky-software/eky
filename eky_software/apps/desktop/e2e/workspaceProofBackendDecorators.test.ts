import { expect, it, vi } from 'vitest';

import type { DesktopBackendHandle, StartDesktopBackendOptions } from '../src/runtime/backendProcess.js';
import { observeSelectorTestBackend } from './electronSelectorTestBackend.js';
import { createTrackedBackendStarter as createActivationStarter } from './workspaceActivationMigrationProof.js';
import { createTrackedBackendStarter as createFirstStartStarter } from './workspaceFirstStartMigrationProof.js';

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, ipcMain: {},
  protocol: {}, session: {}, shell: {}, dialog: {}, utilityProcess: {}, MessageChannelMain: class {} }));

const operationId = '11111111-1111-4111-8111-111111111111';
const variants = ['selector', 'firstStart', 'activation'] as const;

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

function fixture(variant: typeof variants[number]) {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const stopForDelete = vi.fn(async (_operationId: string) => pending);
  const ordinaryStop = vi.fn(async () => 'exited' as const);
  const delegate = vi.fn(async (): Promise<DesktopBackendHandle> => ({
    port: 12345, onUnexpectedExit() {}, stop: ordinaryStop, stopForDelete,
    async stopForUpdate() {}, async stopForRestore() {},
  }));
  const tracker = { activeHandles: new Set<DesktopBackendHandle>(), startCount: 0,
    databaseStarts: [] as string[], relaunchCount: 0, successfulStartCount: 0,
    runtimeSessionCount: 0, selectorCleanupFailed: false };
  const observer = observeSelectorTestBackend(delegate);
  const start = variant === 'selector' ? observer.startBackend
    : (variant === 'firstStart' ? createFirstStartStarter : createActivationStarter)({ delegate, tracker });
  const options = { config: { databaseFilePath: 'synthetic-unopened-database' } } as StartDesktopBackendOptions;
  return { start: () => start(options), release, stopForDelete, ordinaryStop,
    isRunning: () => variant === 'selector' ? observer.snapshot().running : tracker.activeHandles.size !== 0 };
}
