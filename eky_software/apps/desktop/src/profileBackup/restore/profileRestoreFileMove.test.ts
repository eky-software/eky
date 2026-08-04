import { describe, expect, it, vi } from 'vitest';

import { renameProfilePathWithRetry } from './profileRestoreFileMove.js';

describe('profile restore file move', () => {
  it('retries bounded Windows sharing failures before succeeding', async () => {
    const renamePath = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(createNodeError('EPERM'))
      .mockRejectedValueOnce(createNodeError('EBUSY'))
      .mockResolvedValueOnce();
    const wait = vi.fn(async () => undefined);

    await expect(
      renameProfilePathWithRetry({
        destinationPath: 'D:\\runtime\\rollback\\eky.sqlite',
        platform: 'win32',
        renamePath,
        sourcePath: 'D:\\runtime\\data\\eky.sqlite',
        wait,
      }),
    ).resolves.toBeUndefined();

    expect(renamePath).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[25], [50]]);
  });

  it.each(['ENOSPC', 'EROFS'] as const)(
    'RESTORE-DISK-001 @fault fails closed without retrying a %s filesystem failure',
    async (windowsErrorCode) => {
      const windowsRename = vi.fn(async () => {
        throw createNodeError(windowsErrorCode);
      });
      const linuxRename = vi.fn(async () => {
        throw createNodeError('EPERM');
      });
      const wait = vi.fn(async () => undefined);

      await expect(
        renameProfilePathWithRetry({
          destinationPath: 'destination',
          platform: 'win32',
          renamePath: windowsRename,
          sourcePath: 'source',
          wait,
        }),
      ).rejects.toMatchObject({ code: windowsErrorCode });
      await expect(
        renameProfilePathWithRetry({
          destinationPath: 'destination',
          platform: 'linux',
          renamePath: linuxRename,
          sourcePath: 'source',
          wait,
        }),
      ).rejects.toMatchObject({ code: 'EPERM' });

      expect(windowsRename).toHaveBeenCalledTimes(1);
      expect(linuxRename).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it('stops after the bounded Windows retry schedule', async () => {
    const renamePath = vi.fn(async () => {
      throw createNodeError('EACCES');
    });
    const wait = vi.fn(async () => undefined);

    await expect(
      renameProfilePathWithRetry({
        destinationPath: 'destination',
        platform: 'win32',
        renamePath,
        sourcePath: 'source',
        wait,
      }),
    ).rejects.toMatchObject({ code: 'EACCES' });

    expect(renamePath).toHaveBeenCalledTimes(7);
    expect(wait.mock.calls).toEqual([
      [25],
      [50],
      [100],
      [200],
      [400],
      [800],
    ]);
  });
});

function createNodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error('synthetic rename failure'), { code });
}
