import { expect, it, vi } from 'vitest';
import { selectDesktopWorkspaceRecoveryChoice } from './desktopWorkspaceRecoveryChoice.js';
import type { DesktopWorkspaceRecoveryReadAuthority } from './desktopWorkspaceRecoverySources.js';

function fixture(response: unknown = 0) {
  const controller = new AbortController(), events: string[] = [];
  const assertCurrent = vi.fn<() => void>(() => undefined);
  const ownership = { assertCurrent: vi.fn<() => void>(() => undefined), assertOwned: vi.fn(async () => undefined) };
  const readSelected = vi.fn(async (authority: DesktopWorkspaceRecoveryReadAuthority) => {
    authority.assertCurrent(); await authority.assertOwned(); authority.assertCurrent(); events.push('selected');
  });
  const showMessageBox = vi.fn(async (_options: unknown): Promise<unknown> => { events.push('dialog'); return { response }; });
  const target = { workspaceLabel: 'Synthetic selected workspace' };
  const input = { selection: { target, assertCurrent, readSelected }, ownership,
    signal: controller.signal, showMessageBox };
  return { input, controller, events, assertCurrent, readSelected, showMessageBox, target, ownership };
}

it.for([{ response: 0, choice: 'recover' }, { response: 1, choice: 'manage' }, { response: 2, choice: 'close' }])(
  'returns $choice only after the same selected source and native dialog have settled', async ({ response, choice }) => {
    const f = fixture(response);
    await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).resolves.toBe(choice);
    expect(f.events).toEqual(['selected', 'dialog', 'selected']);
    expect(f.showMessageBox).toHaveBeenCalledOnce();
    expect(f.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      buttons: ['Jatka palautumista', 'Rajattu hallinta', 'Sulje'], defaultId: 0, cancelId: 2, noLink: true,
      signal: f.controller.signal,
    }));
    for (const [authority] of f.readSelected.mock.calls) {
      expect(authority).toMatchObject({ assertCurrent: expect.any(Function), assertOwned: expect.any(Function) });
    }
  },
);

it.for([-1, 3, 0.5, NaN, '1', null])('rejects an unexpected native response %s without granting a choice', async response => {
  const f = fixture(response);
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
  expect(f.readSelected).toHaveBeenCalledOnce(); expect(f.showMessageBox).toHaveBeenCalledOnce();
});

it('does not show a dialog after the original source proof fails', async () => {
  const f = fixture(), first = new Error('SYNTHETIC_ORIGINAL_SELECTION_FAILED');
  f.readSelected.mockRejectedValueOnce(first);
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.showMessageBox).not.toHaveBeenCalled();
});

it('does not show a dialog when the supplied native ownership read fails', async () => {
  const f = fixture(), first = new Error('SYNTHETIC_NATIVE_OWNERSHIP_FAILED');
  f.ownership.assertOwned.mockRejectedValueOnce(first);
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.showMessageBox).not.toHaveBeenCalled();
});

it('does not accept a choice after native ownership changes during the dialog', async () => {
  const f = fixture(1), first = new Error('SYNTHETIC_NATIVE_OWNERSHIP_LOST');
  f.showMessageBox.mockImplementationOnce(async () => {
    f.ownership.assertCurrent.mockImplementation(() => { throw first; });
    return { response: 1 };
  });
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.readSelected).toHaveBeenCalledOnce();
});

it.for([0, 1, 2])('does not turn a late source failure into native response %s', async response => {
  const f = fixture(response), first = new Error('SYNTHETIC_LATE_SELECTION_FAILED');
  f.readSelected.mockResolvedValueOnce(undefined).mockRejectedValueOnce(first);
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.events).toEqual(['dialog']); expect(f.showMessageBox).toHaveBeenCalledOnce();
});

it('does not read or show after startup was already aborted', async () => {
  const f = fixture(), first = new Error('SYNTHETIC_STARTUP_CLOSED');
  f.controller.abort(first);
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.readSelected).not.toHaveBeenCalled(); expect(f.showMessageBox).not.toHaveBeenCalled();
});

it('does not show after cancellation during the initial source read', async () => {
  const f = fixture(), first = new Error('SYNTHETIC_STARTUP_CLOSED');
  f.readSelected.mockImplementationOnce(async () => { f.controller.abort(first); });
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.showMessageBox).not.toHaveBeenCalled();
});

it.for(['initial', 'final'] as const)('rejects cancellation in the outer %s read continuation', async boundary => {
  const f = fixture(1), first = new Error('SYNTHETIC_OUTER_READ_CLOSED');
  const closeAfterInnerRead = async () => {
    queueMicrotask(() => queueMicrotask(() => f.controller.abort(first)));
  };
  if (boundary === 'initial') f.readSelected.mockImplementationOnce(closeAfterInnerRead);
  else f.readSelected.mockResolvedValueOnce(undefined).mockImplementationOnce(closeAfterInnerRead);
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.showMessageBox).toHaveBeenCalledTimes(boundary === 'initial' ? 0 : 1);
});

it.for(['selection', 'native'] as const)('does not begin a read after the %s guard closes startup', async boundary => {
  const f = fixture(), first = new Error('SYNTHETIC_REENTRANT_GUARD_CLOSED');
  const guard = boundary === 'selection' ? f.assertCurrent : f.ownership.assertCurrent;
  guard.mockImplementationOnce(() => { f.controller.abort(first); });
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.readSelected).not.toHaveBeenCalled(); expect(f.showMessageBox).not.toHaveBeenCalled();
});

it('waits for the original native promise after abort before exposing cancellation', async context => {
  const f = fixture(), first = new Error('SYNTHETIC_STARTUP_CLOSED');
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  f.showMessageBox.mockImplementationOnce(async () => { enter(); await held; return { response: 2 }; });
  let settled = false;
  const work = selectDesktopWorkspaceRecoveryChoice(f.input).finally(() => { settled = true; });
  const outcome = work.then(value => ({ value }), (error: unknown) => ({ error }));
  context.onTestFinished(async () => { enter(); release(); await outcome; });
  try {
    await entered;
    f.controller.abort(first);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false); expect(f.readSelected).toHaveBeenCalledOnce();
    release();
    expect(await outcome).toEqual({ error: first });
    expect(f.readSelected).toHaveBeenCalledOnce();
  } finally { enter(); release(); await outcome; }
});

it('keeps a native failure as the first cause even if abort arrived before rejection', async () => {
  const f = fixture(), first = new Error('SYNTHETIC_NATIVE_FAILURE');
  f.showMessageBox.mockImplementationOnce(async () => {
    f.controller.abort(new Error('SYNTHETIC_LATER_ABORT')); throw first;
  });
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).rejects.toBe(first);
  expect(f.readSelected).toHaveBeenCalledOnce();
});

it('captures the label and callbacks before the first awaited read', async () => {
  const f = fixture();
  f.readSelected.mockImplementationOnce(async () => {
    f.target.workspaceLabel = 'Synthetic later label';
    f.input.showMessageBox = vi.fn(async () => { throw new Error('SYNTHETIC_REBOUND_DIALOG'); });
    f.input.selection.readSelected = vi.fn(async () => { throw new Error('SYNTHETIC_REBOUND_READ'); });
  });
  await expect(selectDesktopWorkspaceRecoveryChoice(f.input)).resolves.toBe('recover');
  expect(f.readSelected).toHaveBeenCalledTimes(2);
  expect(f.showMessageBox.mock.calls[0]?.[0]).toMatchObject({ detail: expect.stringContaining('Synthetic selected workspace') });
  expect(JSON.stringify(f.showMessageBox.mock.calls)).not.toContain('Synthetic later label');
});
