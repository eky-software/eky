import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { loadApplicationWindow } from './applicationWindow.js';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

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
});
