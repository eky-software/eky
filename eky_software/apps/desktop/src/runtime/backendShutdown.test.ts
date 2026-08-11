import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BackendGracefulShutdownTimeoutError,
  waitForBackendShutdown,
  type BackendShutdownProcess,
} from './backendShutdown.js';

describe('backend shutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('acknowledges a graceful process exit without forcing termination', async () => {
    vi.useFakeTimers();
    const fixture = createProcessFixture();
    const outcome = waitForBackendShutdown(fixture.processHandle, {
      forceAfterTimeout: false,
      timeoutMilliseconds: 3_000,
    });

    fixture.exit();

    await expect(outcome).resolves.toBe('exited');
    expect(fixture.kill).not.toHaveBeenCalled();
  });

  it('fails an update shutdown without treating forced termination as success', async () => {
    vi.useFakeTimers();
    const fixture = createProcessFixture();
    const outcome = waitForBackendShutdown(fixture.processHandle, {
      forceAfterTimeout: false,
      timeoutMilliseconds: 3_000,
    });
    const rejection = expect(outcome).rejects.toBeInstanceOf(
      BackendGracefulShutdownTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(3_000);

    await rejection;
    expect(fixture.kill).not.toHaveBeenCalled();
  });

  it('keeps forced termination as the final fallback for ordinary app shutdown', async () => {
    vi.useFakeTimers();
    const fixture = createProcessFixture();
    const outcome = waitForBackendShutdown(fixture.processHandle, {
      forceAfterTimeout: true,
      timeoutMilliseconds: 3_000,
    });

    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe('forced');
    expect(fixture.kill).toHaveBeenCalledOnce();
  });
});

function createProcessFixture(): {
  exit(): void;
  kill: ReturnType<typeof vi.fn>;
  processHandle: BackendShutdownProcess;
} {
  let exitListener: (() => void) | undefined;
  const kill = vi.fn(() => true);
  return {
    exit() {
      exitListener?.();
    },
    kill,
    processHandle: {
      kill,
      once(event, listener) {
        if (event === 'exit') {
          exitListener = listener;
        }
      },
    },
  };
}
