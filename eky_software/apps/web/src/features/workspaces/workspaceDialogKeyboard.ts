export type WorkspaceDialogFocusTarget = 'first' | 'last' | null;

export function shouldCloseWorkspaceDialog(
  key: string,
  isBusy: boolean,
): boolean {
  return key === 'Escape' && !isBusy;
}

export function resolveWorkspaceDialogFocusTarget(input: {
  readonly activeIndex: number;
  readonly focusableCount: number;
  readonly shiftKey: boolean;
}): WorkspaceDialogFocusTarget {
  if (input.focusableCount <= 0) return 'first';
  if (input.activeIndex < 0) return input.shiftKey ? 'last' : 'first';
  if (input.shiftKey && input.activeIndex === 0) return 'last';
  if (!input.shiftKey && input.activeIndex === input.focusableCount - 1) {
    return 'first';
  }
  return null;
}
