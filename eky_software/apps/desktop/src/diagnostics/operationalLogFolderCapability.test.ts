import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openOperationalLogFolderIpcChannel } from './desktopDiagnosticsTypes.js';
import {
  createOperationalLogFolderCapability,
  resolveOperationalLogsRoot,
} from './operationalLogFolderCapability.js';

const temporaryRoots: string[] = [];

describe('operational log folder capability', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('opens only the main-owned runtime logs directory without renderer input', async () => {
    const runtimeRoot = createRuntimeRoot();
    const fixture = createFixture(runtimeRoot);

    await fixture.invoke(fixture.trustedEvent);

    expect(fixture.openPath).toHaveBeenCalledWith(join(runtimeRoot, 'logs'));
    expect(fixture.showSafeError).not.toHaveBeenCalled();
  });

  it('rejects renderer arguments and requests outside the trusted main frame', async () => {
    const fixture = createFixture(createRuntimeRoot());

    await expect(
      fixture.invoke(fixture.trustedEvent, '../../secret'),
    ).rejects.toThrow('OPERATIONAL_LOG_FOLDER_FORBIDDEN');
    await expect(
      fixture.invoke({
        sender: {},
        senderFrame: fixture.mainFrame,
      }),
    ).rejects.toThrow('OPERATIONAL_LOG_FOLDER_FORBIDDEN');
    expect(fixture.openPath).not.toHaveBeenCalled();
  });

  it('refuses a symbolic-link logs directory and returns only a safe error', async () => {
    const runtimeRoot = createRuntimeRoot();
    const outsideRoot = createRuntimeRoot();
    symlinkSync(
      outsideRoot,
      join(runtimeRoot, 'logs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const fixture = createFixture(runtimeRoot);

    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow(
      'OPERATIONAL_LOG_FOLDER_OPEN_FAILED',
    );
    expect(fixture.openPath).not.toHaveBeenCalled();
    expect(fixture.showSafeError).toHaveBeenCalledOnce();
  });

  it('requires an absolute runtime root and removes its handler on dispose', () => {
    expect(() => resolveOperationalLogsRoot('relative/runtime')).toThrow(
      'Desktop runtime root must be absolute.',
    );

    const fixture = createFixture(createRuntimeRoot());
    fixture.capability.dispose();

    expect(fixture.removeHandler).toHaveBeenLastCalledWith(
      openOperationalLogFolderIpcChannel,
    );
  });
});

function createRuntimeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-desktop-diagnostics-'));
  temporaryRoots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

function createFixture(runtimeRoot: string) {
  let handler:
    | ((event: unknown, ...args: unknown[]) => Promise<void>)
    | undefined;
  const handle = vi.fn(
    (
      channel: string,
      registeredHandler: (
        event: unknown,
        ...args: unknown[]
      ) => Promise<void>,
    ) => {
      expect(channel).toBe(openOperationalLogFolderIpcChannel);
      handler = registeredHandler;
    },
  );
  const removeHandler = vi.fn();
  const mainFrame = {};
  const webContents = { mainFrame };
  const mainWindow = {
    isDestroyed: () => false,
    webContents,
  };
  const openPath = vi.fn(async () => '');
  const showSafeError = vi.fn();
  const capability = createOperationalLogFolderCapability({
    ipcMain: { handle, removeHandler } as never,
    mainWindow: mainWindow as never,
    openPath,
    runtimeRoot,
    showSafeError,
  });

  return {
    capability,
    invoke(event: unknown, ...args: unknown[]) {
      if (handler === undefined) {
        throw new Error('Test handler was not registered.');
      }
      return handler(event, ...args);
    },
    mainFrame,
    openPath,
    removeHandler,
    showSafeError,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
  };
}
