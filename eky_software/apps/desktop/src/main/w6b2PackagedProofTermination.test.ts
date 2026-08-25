import { describe, expect, it, vi } from 'vitest';

import { terminateW6b2PackagedProofRuntime } from './w6b2PackagedProofTermination.js';

describe('W6B.2 packaged proof termination', () => {
  it('shuts down the runtime and destroys the window before quitting', async () => {
    const order: string[] = [];
    const fixture = createFixture({
      destroy() {
        order.push('window.destroy');
      },
      quitApplication() {
        order.push('application.quit');
      },
      async shutdown() {
        order.push('runtime.shutdown');
      },
    });

    await terminateW6b2PackagedProofRuntime(fixture.options);

    expect(order).toEqual([
      'runtime.shutdown',
      'window.destroy',
      'application.quit',
    ]);
  });

  it('does not destroy an already destroyed window', async () => {
    const fixture = createFixture({ isDestroyed: true });

    await terminateW6b2PackagedProofRuntime(fixture.options);

    expect(fixture.shutdown).toHaveBeenCalledOnce();
    expect(fixture.destroy).not.toHaveBeenCalled();
    expect(fixture.quitApplication).toHaveBeenCalledOnce();
  });

  it('does not quit before runtime shutdown succeeds', async () => {
    const fixture = createFixture({
      async shutdown() {
        throw new Error('private failure');
      },
    });

    await expect(
      terminateW6b2PackagedProofRuntime(fixture.options),
    ).rejects.toThrow('private failure');
    expect(fixture.destroy).not.toHaveBeenCalled();
    expect(fixture.quitApplication).not.toHaveBeenCalled();
  });
});

function createFixture(overrides?: Readonly<{
  destroy?: () => void;
  isDestroyed?: boolean;
  quitApplication?: () => void;
  shutdown?: () => Promise<void>;
}>) {
  const destroy = vi.fn(overrides?.destroy ?? (() => undefined));
  const quitApplication = vi.fn(
    overrides?.quitApplication ?? (() => undefined),
  );
  const shutdown = vi.fn<() => Promise<void>>(
    overrides?.shutdown ?? (async () => undefined),
  );
  return {
    destroy,
    options: {
      lifecycle: {
        applicationWindow: {
          destroy,
          isDestroyed: () => overrides?.isDestroyed ?? false,
        },
        shutdown,
      },
      quitApplication,
    },
    quitApplication,
    shutdown,
  };
}
