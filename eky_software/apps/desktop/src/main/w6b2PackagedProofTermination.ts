import type { DesktopLifecycleHandle } from './desktopComposition.js';

interface W6b2PackagedProofLifecycle {
  readonly applicationWindow: Pick<
    DesktopLifecycleHandle['applicationWindow'],
    'destroy' | 'isDestroyed'
  >;
  shutdown(): Promise<void>;
}

interface W6b2PackagedProofTerminationOptions {
  readonly lifecycle: W6b2PackagedProofLifecycle | undefined;
  readonly relaunchRequested: boolean;
  quitApplication(): void;
}

export async function terminateW6b2PackagedProofRuntime(
  options: Readonly<W6b2PackagedProofTerminationOptions>,
): Promise<void> {
  if (options.lifecycle === undefined) {
    if (!options.relaunchRequested) {
      throw new Error('W6B2_PROOF_TERMINATION_INVALID');
    }
    options.quitApplication();
    return;
  }

  await options.lifecycle.shutdown();

  if (!options.lifecycle.applicationWindow.isDestroyed()) {
    options.lifecycle.applicationWindow.destroy();
  }

  options.quitApplication();
}
