import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BackendForcedShutdownTimeoutError,
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

  it('proves process exit after forced termination for ordinary app shutdown', async () => {
    vi.useFakeTimers();
    const fixture = createProcessFixture();
    const outcome = waitForBackendShutdown(fixture.processHandle, {
      forceAfterTimeout: true,
      timeoutMilliseconds: 3_000,
    });

    await vi.advanceTimersByTimeAsync(3_000);

    expect(fixture.kill).toHaveBeenCalledOnce();
    expect(fixture.hasExited()).toBe(false);

    fixture.exit();

    await expect(outcome).resolves.toBe('forced');
  });

  it('fails closed when forced termination does not produce process exit', async () => {
    vi.useFakeTimers();
    const fixture = createProcessFixture();
    const outcome = waitForBackendShutdown(fixture.processHandle, {
      forceAfterTimeout: true,
      timeoutMilliseconds: 3_000,
    });
    const rejection = expect(outcome).rejects.toBeInstanceOf(
      BackendForcedShutdownTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(6_000);

    await rejection;
    expect(fixture.kill).toHaveBeenCalledOnce();
  });
});

function createProcessFixture(): {
  exit(): void;
  hasExited(): boolean;
  kill: ReturnType<typeof vi.fn>;
  processHandle: BackendShutdownProcess;
} {
  let exitListener: (() => void) | undefined;
  let exited = false;
  const kill = vi.fn(() => true);
  return {
    exit() {
      exited = true;
      exitListener?.();
    },
    hasExited: () => exited,
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
