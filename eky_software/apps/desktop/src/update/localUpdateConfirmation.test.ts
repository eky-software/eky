import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, MessageBoxOptions } from 'electron';

import {
  confirmLocalUpdateWithNativeDialog,
  unsignedPilotUpdateWarning,
} from './localUpdateConfirmation.js';
import type { LocalUpdateStatus } from './localUpdateSelectionTypes.js';

describe('local update native confirmation', () => {
  it('shows every trusted update identity with cancel as the safe default', async () => {
    let capturedDialog: MessageBoxOptions | undefined;
    const showMessageBox = vi.fn(
      async (_owner: BrowserWindow, dialog: MessageBoxOptions) => {
        capturedDialog = dialog;
        return { response: 0 };
      },
    );
    const mainWindow = {} as BrowserWindow;

    await expect(
      confirmLocalUpdateWithNativeDialog({
        mainWindow,
        showMessageBox,
        status,
      }),
    ).resolves.toBe(true);

    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(showMessageBox.mock.calls[0]?.[0]).toBe(mainWindow);
    expect(capturedDialog).toMatchObject({
      buttons: ['Jatka päivitykseen', 'Peruuta'],
      cancelId: 1,
      defaultId: 1,
      noLink: true,
      type: 'warning',
    });
    expect(capturedDialog?.detail).toContain('0.1.0-alpha.1');
    expect(capturedDialog?.detail).toContain('0.1.0-alpha.2');
    expect(capturedDialog?.detail).toContain('0.1.1');
    expect(capturedDialog?.detail).toContain('0.1.2');
    expect(capturedDialog?.detail).toContain('abcdef012345');
    expect(capturedDialog?.detail).toContain('pilot');
    expect(capturedDialog?.detail).toContain('x64');
    expect(capturedDialog?.detail).toContain('Palautuspaketti: valmis');
    expect(capturedDialog?.detail).toContain(
      'Päivitystä edeltävä palautuspiste: luodaan hyväksymisen jälkeen',
    );
    expect(capturedDialog?.detail).toContain(unsignedPilotUpdateWarning);
  });

  it('returns cancellation without opening a dialog when no candidate exists', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 0 }));

    await expect(
      confirmLocalUpdateWithNativeDialog({
        mainWindow: {} as never,
        showMessageBox,
        status: { ...status, candidate: null },
      }),
    ).resolves.toBe(false);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('honors the explicit native cancellation response', async () => {
    await expect(
      confirmLocalUpdateWithNativeDialog({
        mainWindow: {} as never,
        showMessageBox: vi.fn(async () => ({ response: 1 })),
        status,
      }),
    ).resolves.toBe(false);
  });
});

const status: Readonly<LocalUpdateStatus> = Object.freeze({
  architecture: 'x64',
  candidate: Object.freeze({
    appVersion: '0.1.0-alpha.2',
    buildRevision: 'abcdef012345',
    msiProductVersion: '0.1.2',
    packageFingerprint: 'abcdef012345',
    releaseChannel: 'pilot',
    role: 'candidate',
    signingStatus: 'unsigned-prototype',
  }),
  current: Object.freeze({
    appVersion: '0.1.0-alpha.1',
    buildRevision: '123456789abc',
    msiProductVersion: '0.1.1',
    releaseChannel: 'pilot',
  }),
  currentRollbackPackage: 'ready',
  phase: 'idle',
  recoveryPointState: 'notStarted',
  signingStatus: 'unsigned-prototype',
});
