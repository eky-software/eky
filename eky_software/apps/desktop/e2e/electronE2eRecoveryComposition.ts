import type { DesktopLifecycleHandle } from '../src/main/desktopComposition.js';
import type { DesktopQuitLifecycle } from '../src/main/desktopBeforeQuit.js';
import type { createDesktopRecoveryStartup, DesktopRecoveryStartupPort } from '../src/main/desktopRecoveryStartup.js';

// The isolated entry's readiness callback must not run after a fulfilled close.
export async function startElectronE2eRecoveryComposition(input: Readonly<{
  startup: ReturnType<typeof createDesktopRecoveryStartup<DesktopLifecycleHandle>>;
  compose(port: Readonly<DesktopRecoveryStartupPort>): Promise<DesktopLifecycleHandle | undefined>;
  publish(lifecycle: DesktopLifecycleHandle | undefined): void;
}>) {
  const outcome = await input.startup.start(input.compose);
  if (outcome.status === 'rejected') {
    if (outcome.cleanupError !== undefined) {
      throw new Error('DESKTOP_START_FAILED', { cause: new AggregateError(
        [outcome.reason, outcome.cleanupError], 'DESKTOP_SHUTDOWN_FAILED', { cause: outcome.reason }) });
    }
    throw outcome.reason;
  }
  if (input.startup.port.isClosing()) return;
  input.publish(outcome.lifecycle);
}

// Joining fixture I/O belongs outside the raw lifecycle it may itself stop.
export function readElectronE2eQuitLifecycle(
  owner: DesktopQuitLifecycle | undefined,
  waitForPreparation: (() => Promise<void>) | undefined,
): DesktopQuitLifecycle | undefined {
  if (owner === undefined || waitForPreparation === undefined) return owner;
  return {
    deferQuitForInstallerHandoff: () => owner.deferQuitForInstallerHandoff?.() ?? false,
    async shutdown() {
      const settled = await Promise.allSettled([
        Promise.resolve().then(() => owner.shutdown()), Promise.resolve().then(waitForPreparation),
      ]);
      const failures = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length !== 0) throw new AggregateError(failures, 'DESKTOP_SHUTDOWN_FAILED', { cause: failures[0] });
    },
  };
}
