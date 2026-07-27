import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openOperationalLogFolderIpcChannel } from './desktopDiagnosticsTypes.js';
import {
  createOperationalLogFolderCapability,
  resolveOperationalLogsRoot,
} from './operationalLogFolderCapability.js';
import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';

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
    expect(fixture.events).toEqual([
      expect.objectContaining({
        eventName: 'operationalLogFolder.opened',
        stage: 'shellOpen',
      }),
    ]);
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
    expect(fixture.events).toEqual([
      expect.objectContaining({
        errorCode: 'OPERATIONAL_LOG_FOLDER_FORBIDDEN',
        eventName: 'operationalLogFolder.requestBlocked',
        stage: 'ipc',
      }),
      expect.objectContaining({
        errorCode: 'OPERATIONAL_LOG_FOLDER_FORBIDDEN',
        eventName: 'operationalLogFolder.requestBlocked',
        stage: 'ipc',
      }),
    ]);
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
    expect(fixture.events).toEqual([
      expect.objectContaining({
        errorCode: 'OPERATIONAL_LOG_FOLDER_OPEN_FAILED',
        eventName: 'operationalLogFolder.openFailed',
        stage: 'ensureDirectory',
      }),
    ]);
    expect(JSON.stringify(fixture.events)).not.toContain(runtimeRoot);
    expect(JSON.stringify(fixture.events)).not.toContain(outsideRoot);
  });

  it('records a safe shell failure without exposing its raw message', async () => {
    const fixture = createFixture(createRuntimeRoot());
    fixture.openPath.mockResolvedValueOnce(
      'C:\\Users\\Example\\Desktop\\sensitive path',
    );

    await expect(fixture.invoke(fixture.trustedEvent)).rejects.toThrow(
      'OPERATIONAL_LOG_FOLDER_OPEN_FAILED',
    );

    expect(fixture.events).toEqual([
      expect.objectContaining({
        errorCode: 'OPERATIONAL_LOG_FOLDER_OPEN_FAILED',
        eventName: 'operationalLogFolder.openFailed',
        stage: 'shellOpen',
      }),
    ]);
    expect(JSON.stringify(fixture.events)).not.toContain('Users');
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
  const events: DesktopOperationalEvent[] = [];
  const capability = createOperationalLogFolderCapability({
    appVersion: '0.0.0',
    ipcMain: { handle, removeHandler } as never,
    mainWindow: mainWindow as never,
    openPath,
    operationalLogger: {
      write(event) {
        events.push(event);
      },
    },
    runtimeRoot,
    showSafeError,
  });

  return {
    capability,
    events,
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
