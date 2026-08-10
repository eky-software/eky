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
});

function createFixture(response: number) {
  const ensureDirectory = vi.fn(async () => undefined);
  const openPath = vi.fn(async () => '');
  const showMessageBox = vi.fn(async () => ({ response }));
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
