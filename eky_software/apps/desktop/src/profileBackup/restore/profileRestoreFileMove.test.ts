import { describe, expect, it, vi } from 'vitest';

import { renameProfilePathWithRetry } from './profileRestoreFileMove.js';

describe('profile restore file move', () => {
  it.each([null, false, 1])('rejects malformed final guard %s before rename or retry', async guard => {
    const renamePath = vi.fn(async () => {}); const wait = vi.fn(async () => {});
    await expect(renameProfilePathWithRetry({ sourcePath: 'source', destinationPath: 'destination',
      renamePath, wait, async assertAuthority() {}, assertMutationCurrent: guard as never,
    })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(renamePath).not.toHaveBeenCalled(); expect(wait).not.toHaveBeenCalled();
  });

  it('preserves legacy authority replacement during the existing retry wait', async () => {
    const first = new Error('SYNTHETIC_LEGACY_AUTHORITY_REVOKED');
    const renamePath = vi.fn(async () => { throw createNodeError('EPERM'); });
    const revoke = vi.fn(async () => { throw first; });
    const options = { sourcePath: 'source', destinationPath: 'destination', platform: 'win32' as const,
      renamePath, async assertAuthority() {}, wait: vi.fn(async () => { options.assertAuthority = revoke; }) };
    await expect(renameProfilePathWithRetry(options)).rejects.toBe(first);
    expect(renamePath).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce();
    expect(options.wait).toHaveBeenCalledExactlyOnceWith(25);
  });

  it('checks the captured synchronous owner after asynchronous authority and before every rename', async () => {
    const first = new Error('SYNTHETIC_FINAL_OWNER_REVOKED');
    let current = true;
    const renamePath = vi.fn(async () => { throw createNodeError('EPERM'); });
    const replacement = vi.fn();
    const options = { sourcePath: 'source', destinationPath: 'destination', platform: 'win32' as const,
      renamePath, wait: vi.fn(async () => { current = false; }),
      async assertAuthority() { options.assertMutationCurrent = replacement; },
      assertMutationCurrent() { if (!current) throw first; },
    };
    await expect(renameProfilePathWithRetry(options)).rejects.toBe(first);
    expect(renamePath).toHaveBeenCalledOnce();
    expect(options.wait).toHaveBeenCalledExactlyOnceWith(25);
    expect(replacement).not.toHaveBeenCalled();
  });

  it.each(['pending', 'resolved', 'rejected'] as const)('rejects a %s asynchronous final guard before rename', async kind => {
    const renamePath = vi.fn(async () => {});
    const wait = vi.fn(async () => {});
    await expect(renameProfilePathWithRetry({ sourcePath: 'source', destinationPath: 'destination',
      renamePath, wait, async assertAuthority() {},
      assertMutationCurrent: () => kind === 'pending' ? new Promise<void>(() => {})
        : kind === 'resolved' ? Promise.resolve() : Promise.reject(new Error('SYNTHETIC_ASYNC_GUARD')),
    })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(renamePath).not.toHaveBeenCalled(); expect(wait).not.toHaveBeenCalled();
  });

  it('does not retry a rename after losing authority during the Windows retry wait', async () => {
    let current = true;
    const primary = new Error('PROFILE_RESTORE_RECOVERY_REQUIRED');
    const renamePath = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(createNodeError('EPERM')).mockResolvedValueOnce();
    const assertAuthority = vi.fn(async () => { if (!current) throw primary; });
    const wait = vi.fn(async () => { current = false; });
    await expect(renameProfilePathWithRetry({ sourcePath: 'source', destinationPath: 'destination',
      platform: 'win32', renamePath, wait, assertAuthority,
    })).rejects.toBe(primary);
    expect(renamePath).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledExactlyOnceWith(25);
    expect(assertAuthority).toHaveBeenCalledTimes(2);
  });

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
