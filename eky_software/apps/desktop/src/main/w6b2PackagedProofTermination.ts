import type { DesktopLifecycleHandle } from './desktopComposition.js';

interface W6b2PackagedProofLifecycle {
  readonly applicationWindow: Pick<
    DesktopLifecycleHandle['applicationWindow'],
    'destroy' | 'isDestroyed'
  >;
  shutdown(): Promise<void>;
}

interface W6b2PackagedProofTerminationOptions {
  readonly lifecycle: W6b2PackagedProofLifecycle;
  quitApplication(): void;
}

export async function terminateW6b2PackagedProofRuntime(
  options: Readonly<W6b2PackagedProofTerminationOptions>,
): Promise<void> {
  await options.lifecycle.shutdown();

  if (!options.lifecycle.applicationWindow.isDestroyed()) {
    options.lifecycle.applicationWindow.destroy();
  }

  options.quitApplication();
}
