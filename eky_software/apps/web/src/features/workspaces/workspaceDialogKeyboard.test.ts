import { describe, expect, it } from 'vitest';

import {
  resolveWorkspaceDialogFocusTarget,
  shouldCloseWorkspaceDialog,
} from './workspaceDialogKeyboard.js';

describe('workspace dialog keyboard policy', () => {
  it('allows Escape only while no workspace operation is busy', () => {
    expect(shouldCloseWorkspaceDialog('Escape', false)).toBe(true);
    expect(shouldCloseWorkspaceDialog('Escape', true)).toBe(false);
    expect(shouldCloseWorkspaceDialog('Enter', false)).toBe(false);
  });

  it('wraps focus at both ends and pulls outside focus back into the dialog', () => {
    expect(
      resolveWorkspaceDialogFocusTarget({
        activeIndex: 2,
        focusableCount: 3,
        shiftKey: false,
      }),
    ).toBe('first');
    expect(
      resolveWorkspaceDialogFocusTarget({
        activeIndex: 0,
        focusableCount: 3,
        shiftKey: true,
      }),
    ).toBe('last');
    expect(
      resolveWorkspaceDialogFocusTarget({
        activeIndex: -1,
        focusableCount: 3,
        shiftKey: false,
      }),
    ).toBe('first');
    expect(
      resolveWorkspaceDialogFocusTarget({
        activeIndex: -1,
        focusableCount: 3,
        shiftKey: true,
      }),
    ).toBe('last');
  });

  it('leaves ordinary in-dialog tab movement to the browser', () => {
    expect(
      resolveWorkspaceDialogFocusTarget({
        activeIndex: 1,
        focusableCount: 3,
        shiftKey: false,
      }),
    ).toBeNull();
  });
});
