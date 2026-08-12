import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMainInvokeEvent,
} from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUpdateRecoveryComposition } from './updateRecoveryComposition.js';
import {
  createUpdateRecoverySupportBundleIpcChannel,
  selectUpdateRecoveryPackageIpcChannel,
} from './updateRecoveryProtocol.js';

describe('update recovery composition', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('passes only the manifest chosen by Electron main to exact rollback', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    const lifecycle = createUpdateRecoveryComposition(fixture.options);
    const handler = fixture.handlers.get(selectUpdateRecoveryPackageIpcChannel)!;

    await expect(handler(trustedEvent(fixture.window))).resolves.toEqual({
      status: 'completed',
    });
    expect(fixture.showOpenDialog).toHaveBeenCalledWith(
      fixture.window,
      expect.objectContaining({ properties: ['openFile'] }),
    );
    expect(
      fixture.rollbackCoordinator.registerAndStartManualRollback,
    ).toHaveBeenCalledWith(fixture.manifestPath);
    expect(fixture.quitApplication).toHaveBeenCalledOnce();
    await lifecycle.shutdown();
  });

  it('writes a technical support bundle only to the main-owned save path', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    const lifecycle = createUpdateRecoveryComposition(fixture.options);
    const handler = fixture.handlers.get(
      createUpdateRecoverySupportBundleIpcChannel,
    )!;

    await expect(handler(trustedEvent(fixture.window))).resolves.toEqual({
      status: 'completed',
    });
    expect(fixture.showSaveDialog).toHaveBeenCalledWith(
      fixture.window,
      expect.objectContaining({
        filters: [
          expect.objectContaining({ extensions: ['json.gz'] }),
        ],
      }),
    );
    expect((await readFile(fixture.supportBundlePath)).subarray(0, 2)).toEqual(
      Buffer.from([0x1f, 0x8b]),
    );
    await lifecycle.shutdown();
  });
});

type Handler = (
  event: IpcMainInvokeEvent,
  ...values: unknown[]
) => Promise<unknown>;

class FakeWebContents extends EventEmitter {
  readonly mainFrame = {};
  setWindowOpenHandler = vi.fn();
}

class FakeWindow extends EventEmitter {
  destroyed = false;
  readonly webContents = new FakeWebContents();
  readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });
  readonly focus = vi.fn();
  readonly loadURL = vi.fn(async () => undefined);
  readonly removeMenu = vi.fn();
  readonly show = vi.fn();

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-composition-'));
  const handlers = new Map<string, Handler>();
  const window = new FakeWindow();
  const manifestPath = join(root, 'rollback-manifest.json');
  const supportBundlePath = join(root, 'support.json.gz');
  const rollbackCoordinator = {
    registerAndStartManualRollback: vi.fn(async () => 'launched' as const),
  };
  const quitApplication = vi.fn();
  const showOpenDialog = vi.fn(async () => ({
    canceled: false,
    filePaths: [manifestPath],
  }));
  const showSaveDialog = vi.fn(async () => ({
    canceled: false,
    filePath: supportBundlePath,
  }));

  return {
    handlers,
    manifestPath,
    options: {
      applicationPath: 'C:\\Eky\\resources',
      architecture: 'x64',
      createWindow: vi.fn((_options: BrowserWindowConstructorOptions) =>
        window as unknown as BrowserWindow,
      ),
      electronVersion: '43.2.0',
      input: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: 'a'.repeat(40),
        errorCode: 'UPDATE_ROLLBACK_PACKAGE_REQUIRED',
        rollbackPackageSelectionAllowed: true,
      },
      ipcMain: {
        handle(channel: string, handler: Handler) {
          handlers.set(channel, handler);
        },
        removeHandler(channel: string) {
          handlers.delete(channel);
        },
      },
      logsRoot: join(root, 'logs'),
      openPath: vi.fn(async () => ''),
      quitApplication,
      rollbackCoordinator,
      showOpenDialog,
      showSaveDialog,
    },
    quitApplication,
    root,
    rollbackCoordinator,
    showOpenDialog,
    showSaveDialog,
    supportBundlePath,
    window,
  };
}

function trustedEvent(window: FakeWindow): IpcMainInvokeEvent {
  return {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent;
}
