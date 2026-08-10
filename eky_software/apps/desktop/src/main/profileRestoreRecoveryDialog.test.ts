import { describe, expect, it, vi } from 'vitest';

import { showProfileRestoreRecoveryDialog } from './profileRestoreRecoveryDialog.js';

describe('profile restore recovery dialog', () => {
  it('defaults to closing without opening any path', async () => {
    const fixture = createFixture(0);

    await showProfileRestoreRecoveryDialog(fixture.options);

    expect(fixture.ensureDirectory).not.toHaveBeenCalled();
    expect(fixture.openPath).not.toHaveBeenCalled();
    expect(fixture.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ cancelId: 0, defaultId: 0 }),
    );
  });

  it('opens only the main-derived operational log directory', async () => {
    const fixture = createFixture(1);

    await showProfileRestoreRecoveryDialog(fixture.options);

    expect(fixture.ensureDirectory).toHaveBeenCalledWith(
      'trusted-runtime/logs',
    );
    expect(fixture.openPath).toHaveBeenCalledWith('trusted-runtime/logs');
    expect(JSON.stringify(fixture.showMessageBox.mock.calls)).not.toContain(
      'trusted-runtime',
    );
  });

  it('shows only a fixed safe message when the shell returns a raw error', async () => {
    const fixture = createFixture(1, 0);
    fixture.openPath.mockResolvedValueOnce(
      'C:\\Users\\Example\\Desktop\\sensitive path',
    );

    await showProfileRestoreRecoveryDialog(fixture.options);

    expect(fixture.showMessageBox).toHaveBeenCalledTimes(2);
    expect(fixture.showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({
        buttons: ['Sulje', 'Yritä uudelleen'],
        cancelId: 0,
        defaultId: 0,
        message: 'Lokikansiota ei voitu avata.',
      }),
    );
    expect(JSON.stringify(fixture.showMessageBox.mock.calls)).not.toContain(
      'sensitive path',
    );
    expect(JSON.stringify(fixture.showMessageBox.mock.calls)).not.toContain(
      'trusted-runtime',
    );
  });

  it('allows an explicit retry after a directory or shell failure', async () => {
    const fixture = createFixture(1, 1);
    fixture.ensureDirectory
      .mockRejectedValueOnce(new Error('C:\\private\\raw error'))
      .mockResolvedValueOnce(undefined);

    await showProfileRestoreRecoveryDialog(fixture.options);

    expect(fixture.ensureDirectory).toHaveBeenCalledTimes(2);
    expect(fixture.openPath).toHaveBeenCalledOnce();
    expect(JSON.stringify(fixture.showMessageBox.mock.calls)).not.toContain(
      'private',
    );
  });

  it('handles a rejected shell call without exposing its error', async () => {
    const fixture = createFixture(1, 0);
    fixture.openPath.mockRejectedValueOnce(
      new Error('C:\\private\\shell failure'),
    );

    await showProfileRestoreRecoveryDialog(fixture.options);

    expect(fixture.showMessageBox).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fixture.showMessageBox.mock.calls)).not.toContain(
      'shell failure',
    );
  });
});

function createFixture(...responses: number[]) {
  const ensureDirectory = vi.fn(async () => undefined);
  const openPath = vi.fn(async () => '');
  const showMessageBox = vi.fn(async () => ({
    response: responses.shift() ?? 0,
  }));
  return {
    ensureDirectory,
    openPath,
    options: {
      ensureDirectory,
      logsRoot: 'trusted-runtime/logs',
      openPath,
      showMessageBox,
    },
    showMessageBox,
  };
}
