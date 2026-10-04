interface DesktopQuitLifecycle {
  shutdown(): Promise<void>;
}

interface DesktopBeforeQuitOptions {
  readLifecycle(): DesktopQuitLifecycle | undefined;
  quitApplication(): void;
}

interface DesktopBeforeQuitEvent {
  preventDefault(): void;
}

export function createDesktopBeforeQuitHandler(
  options: Readonly<DesktopBeforeQuitOptions>,
): (event: DesktopBeforeQuitEvent) => Promise<void> {
  let shutdownState: 'idle' | 'pending' | 'settled' = 'idle';

  return async (event) => {
    if (shutdownState === 'settled') return;
    if (shutdownState === 'pending') {
      event.preventDefault();
      return;
    }

    const lifecycle = options.readLifecycle();
    if (lifecycle === undefined) return;

    event.preventDefault();
    shutdownState = 'pending';
    try {
      await lifecycle.shutdown();
    } catch {
      // The lifecycle owns failure reporting; quit still follows settlement.
    }
    shutdownState = 'settled';
    options.quitApplication();
  };
}
