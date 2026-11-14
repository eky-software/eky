import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { createApplicationWindow, loadApplicationWindow } from './applicationWindow.js';
import { createDesktopRecoveryStartup } from './desktopRecoveryStartup.js';

const nativeWindow = vi.hoisted(() => ({ ready: undefined as (() => void) | undefined, show: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: class {
  show = nativeWindow.show;
  webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
  removeMenu() {}
  once(event: string, callback: () => void) { if (event === 'ready-to-show') nativeWindow.ready = callback; }
} }));

describe('application window selection', () => {
  it.each([
    ['business', 'eky://app/index.html'],
    ['selector', 'eky://app/index.html#workspace-selector'],
  ] as const)('loads only the packaged app for %s', async (mode, url) => {
    const loadURL = vi.fn(async () => undefined);
    await loadApplicationWindow({ loadURL } as unknown as BrowserWindow, mode);
    expect(loadURL).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('keeps business as the default and maps native errors without disclosing them', async () => {
    const loadURL = vi.fn(async () => { throw new Error('synthetic private native detail'); });
    await expect(loadApplicationWindow({ loadURL } as unknown as BrowserWindow))
      .rejects.toThrow('DESKTOP_SMOKE_RENDERER_FAILED');
    expect(loadURL).toHaveBeenCalledExactlyOnceWith('eky://app/index.html');
  });

  it('shows an ordinary window when its native ready event arrives', () => {
    nativeWindow.show.mockClear();
    createApplicationWindow('synthetic-application');
    expect(nativeWindow.ready).toBeTypeOf('function');
    nativeWindow.ready!();
    expect(nativeWindow.show).toHaveBeenCalledOnce();
  });

  it('does not show a late native window after recovery startup handed off and ordinary quit began', async () => {
    const startup = createDesktopRecoveryStartup();
    await startup.start(async port => {
      port.registerObservation({ closeAdmission() {}, waitForSettlement: async () => undefined });
      return { shutdown: async () => undefined };
    });
    nativeWindow.show.mockClear();
    createApplicationWindow('synthetic-application', true, undefined, () => !startup.port.isClosing());
    startup.beforeQuit();
    nativeWindow.ready!();
    expect(nativeWindow.show).not.toHaveBeenCalled();
    expect(startup.port.isClosing()).toBe(true);
  });
});
