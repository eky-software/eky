import { describe, expect, it, vi } from 'vitest';

import { createBusinessRuntimeShutdown } from './businessRuntimeShutdown.js';

describe('business runtime shutdown', () => {
  it('stops recovery checks and backend only once after a successful stop', async () => {
    const stopRecoveryChecks = vi.fn(async () => undefined);
    const stopBackend = vi.fn(async () => undefined);
    const shutdown = createBusinessRuntimeShutdown({
      stopBackend,
      stopRecoveryChecks,
    });

    await shutdown.stop();
    await shutdown.stop();

    expect(stopRecoveryChecks).toHaveBeenCalledTimes(1);
    expect(stopBackend).toHaveBeenCalledTimes(1);
    expect(stopRecoveryChecks.mock.invocationCallOrder[0]).toBeLessThan(
      stopBackend.mock.invocationCallOrder[0]!,
    );
  });

  it('shares an active stop between concurrent callers', async () => {
    let releaseBackend: (() => void) | undefined;
    const backendStopped = new Promise<void>((resolve) => {
      releaseBackend = resolve;
    });
    const stopRecoveryChecks = vi.fn(async () => undefined);
    const stopBackend = vi.fn(() => backendStopped);
    const shutdown = createBusinessRuntimeShutdown({
      stopBackend,
      stopRecoveryChecks,
    });

    const first = shutdown.stop();
    const second = shutdown.stop();
    releaseBackend?.();
    await Promise.all([first, second]);

    expect(stopRecoveryChecks).toHaveBeenCalledTimes(1);
    expect(stopBackend).toHaveBeenCalledTimes(1);
  });

  it('allows a controlled retry after a failed stop', async () => {
    const stopRecoveryChecks = vi.fn(async () => undefined);
    const stopBackend = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('BACKEND_STOP_FAILED'))
      .mockResolvedValueOnce(undefined);
    const shutdown = createBusinessRuntimeShutdown({
      stopBackend,
      stopRecoveryChecks,
    });

    await expect(shutdown.stop()).rejects.toThrow('BACKEND_STOP_FAILED');
    await expect(shutdown.stop()).resolves.toBeUndefined();

    expect(stopRecoveryChecks).toHaveBeenCalledTimes(2);
    expect(stopBackend).toHaveBeenCalledTimes(2);
  });
});
