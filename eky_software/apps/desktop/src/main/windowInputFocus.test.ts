import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { restoreWindowInputFocus } from './windowInputFocus.js';

describe('restoreWindowInputFocus', () => {
  it('restores a minimized application window and its renderer input focus', () => {
    const window = createWindow({ minimized: true, visible: false });

    restoreWindowInputFocus(window.value);

    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.webContentsFocus).toHaveBeenCalledOnce();
  });

  it('does nothing for a destroyed or missing window', () => {
    const window = createWindow({ destroyed: true });

    restoreWindowInputFocus(window.value);
    restoreWindowInputFocus(undefined);

    expect(window.restore).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.webContentsFocus).not.toHaveBeenCalled();
  });
});

function createWindow(
  options: {
    destroyed?: boolean;
    minimized?: boolean;
    visible?: boolean;
  } = {},
) {
  const focus = vi.fn();
  const restore = vi.fn();
  const show = vi.fn();
  const webContentsFocus = vi.fn();

  return {
    focus,
    restore,
    show,
    value: {
      focus,
      isDestroyed: () => options.destroyed === true,
      isMinimized: () => options.minimized === true,
      isVisible: () => options.visible !== false,
      restore,
      show,
      webContents: { focus: webContentsFocus },
    } as unknown as BrowserWindow,
    webContentsFocus,
  };
}
