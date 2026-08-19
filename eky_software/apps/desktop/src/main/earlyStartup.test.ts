import { describe, expect, it, vi } from 'vitest';

import {
  readSafeStartupFailureCode,
  runSafeDesktopStartup,
} from './earlyStartup.js';

describe('safe desktop early startup', () => {
  it('maps a runtime module import failure to a safe code and exits', async () => {
    const fixture = createFixture({
      loadRuntime: async () => {
        throw new Error(
          'Cannot find module C:\\Users\\Example\\private\\desktopComposition.js',
        );
      },
    });

    await runSafeDesktopStartup(fixture.options);

    expect(fixture.onFailure).toHaveBeenCalledWith('DESKTOP_START_FAILED');
    expect(JSON.stringify(fixture.onFailure.mock.calls)).not.toContain(
      'Users',
    );
    expect(fixture.exitApplication).toHaveBeenCalledWith(1);
  });

  it('preserves only an allowlisted runtime startup code', async () => {
    const fixture = createFixture({
      startRuntime: async () => {
        throw new Error('BACKEND_READINESS_TIMEOUT');
      },
    });

    await runSafeDesktopStartup(fixture.options);

    expect(fixture.onFailure).toHaveBeenCalledWith(
      'BACKEND_READINESS_TIMEOUT',
    );
    expect(fixture.exitApplication).toHaveBeenCalledWith(1);
  });

  it('does not report or exit after successful startup', async () => {
    const fixture = createFixture();

    await runSafeDesktopStartup(fixture.options);

    expect(fixture.onFailure).not.toHaveBeenCalled();
    expect(fixture.exitApplication).not.toHaveBeenCalled();
  });

  it('exits without exposing a reporter failure', async () => {
    const fixture = createFixture({
      onFailure: vi.fn(async () => {
        throw new Error('synthetic reporter failure');
      }),
      waitUntilReady: async () => {
        throw new Error('synthetic startup failure');
      },
    });

    await expect(
      runSafeDesktopStartup(fixture.options),
    ).resolves.toBeUndefined();
    expect(fixture.exitApplication).toHaveBeenCalledWith(1);
  });

  it('does not expose raw messages or stack-like content as smoke codes', () => {
    expect(
      readSafeStartupFailureCode(
        new Error(
          'Error: failed\n at C:\\Users\\Example\\application.asar\\main.js:1',
        ),
      ),
    ).toBe('DESKTOP_START_FAILED');
    expect(
      readSafeStartupFailureCode(new Error('PACKAGED_SMOKE_FAILED')),
    ).toBe('PACKAGED_SMOKE_FAILED');
    expect(
      readSafeStartupFailureCode(new Error('PACKAGED_BUILD_INFO_INVALID')),
    ).toBe('PACKAGED_BUILD_INFO_INVALID');
    expect(
      readSafeStartupFailureCode(
        new Error('PROFILE_SNAPSHOT_ARTIFACTS_FAILED'),
      ),
    ).toBe('PROFILE_SNAPSHOT_ARTIFACTS_FAILED');
    expect(
      readSafeStartupFailureCode(
        new Error('PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED'),
      ),
    ).toBe('PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED');
    expect(
      readSafeStartupFailureCode(
        new Error('PROFILE_SNAPSHOT_STAGING_FAILED'),
      ),
    ).toBe('PROFILE_SNAPSHOT_STAGING_FAILED');
    expect(
      readSafeStartupFailureCode(
        new Error('DESKTOP_SMOKE_RESTORE_COMPARISON_FAILED'),
      ),
    ).toBe('DESKTOP_SMOKE_RESTORE_COMPARISON_FAILED');
    expect(
      readSafeStartupFailureCode(
        new Error('WORKSPACE_ADOPTION_RECOVERY_REQUIRED'),
      ),
    ).toBe('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    expect(
      readSafeStartupFailureCode(
        new Error('WORKSPACE_SWITCH_STORAGE_FAILED'),
      ),
    ).toBe('WORKSPACE_SWITCH_STORAGE_FAILED');
    expect(
      readSafeStartupFailureCode(new Error('WORKSPACE_ROOT_INVALID')),
    ).toBe('WORKSPACE_ROOT_INVALID');
    expect(
      readSafeStartupFailureCode(
        new Error('DESKTOP_SMOKE_FAILED\nC:\\Users\\Example\\secret.txt'),
      ),
    ).toBe('DESKTOP_START_FAILED');
  });
});

function createFixture(
  overrides: Partial<
    Parameters<typeof runSafeDesktopStartup<() => Promise<void>>>[0]
  > = {},
) {
  const exitApplication = vi.fn();
  const onFailure = vi.fn(async (errorCode: string) => {
    await overrides.onFailure?.(errorCode);
  });
  const startRuntime =
    overrides.startRuntime ??
    vi.fn(async (runtime: () => Promise<void>) => runtime());
  const options = {
    exitApplication,
    loadRuntime:
      overrides.loadRuntime ??
      (async () => ({
        startDesktopComposition: async () => undefined,
      })),
    onFailure,
    startRuntime,
    waitUntilReady:
      overrides.waitUntilReady ?? (async () => undefined),
  };

  return { exitApplication, onFailure, options };
}
