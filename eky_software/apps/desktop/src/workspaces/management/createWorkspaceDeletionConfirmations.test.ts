import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { expect, it, vi } from 'vitest';

import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { createWorkspaceDeletionConfirmations } from './createWorkspaceDeletionConfirmations.js';

const target = Object.freeze({
  workspaceId: validateWorkspaceId('11111111-1111-4111-8111-111111111111'), workspaceLabel: 'Synthetic company',
  profileId: 'a'.repeat(64), lifecycleState: 'ready' as const, previousActiveWorkspaceId: null,
  registrySha256: 'b'.repeat(64), registryEntrySha256: 'c'.repeat(64), rootIdentity: 'd'.repeat(64),
});

it.each(['confirmDataLoss', 'confirmDeletion', 'confirmReturn'] as const)('uses the current owner window and a safe default for %s', async method => {
  const f = fixture();
  await expect(f.confirmations[method](target)).resolves.toBe(false);
  expect(f.show).toHaveBeenCalledExactlyOnceWith(f.window, expect.objectContaining({
    defaultId: 0, cancelId: 0, noLink: true,
  }));
  f.show.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  await expect(f.confirmations[method](target)).resolves.toBe(true);
});

it.each(['window', 'renderer'] as const)('does not open a confirmation for a destroyed %s', async owner => {
  const f = fixture();
  f.state[owner] = false;
  await expect(f.confirmations.confirmDeletion(target)).rejects.toThrow('WORKSPACE_DELETE_AUTHORITY_INVALID');
  expect(f.show).not.toHaveBeenCalled();
});

it('rejects a late native answer after its parent closes', async () => {
  const f = fixture();
  f.show.mockImplementationOnce(async () => {
    f.state.window = false;
    return { response: 1, checkboxChecked: false };
  });
  await expect(f.confirmations.confirmDeletion(target)).rejects.toThrow('WORKSPACE_DELETE_AUTHORITY_INVALID');
});

it('distinguishes returning to the selector from returning to the previous company', async () => {
  const f = fixture();
  await f.confirmations.confirmReturn(target);
  expect(f.show.mock.calls[0]![1].message).toContain('yritysvalintaan');
  await f.confirmations.confirmReturn({ ...target, previousActiveWorkspaceId: target.workspaceId });
  expect(f.show.mock.calls[1]![1].message).toContain('aiempaan yritykseen');
});

it('retains the native failure as the original cause for its caller', async () => {
  const f = fixture();
  const first = new Error('SYNTHETIC_NATIVE_FAILURE');
  f.show.mockRejectedValueOnce(first);
  await expect(f.confirmations.confirmDeletion(target)).rejects.toBe(first);
});

function fixture() {
  const state = { window: true, renderer: true };
  const window = { isDestroyed: () => !state.window, webContents: { isDestroyed: () => !state.renderer } } as unknown as BrowserWindow;
  const show = vi.fn(async (_window: BrowserWindow, _input: MessageBoxOptions) => ({ response: 0, checkboxChecked: false }));
  return { window, state, show,
    confirmations: createWorkspaceDeletionConfirmations({ getWindow: () => window, showMessageBox: show }) };
}
