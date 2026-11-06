interface DesktopQuitLifecycle {
  deferQuitForInstallerHandoff?(): boolean;
  shutdown(): Promise<void>;
}

interface DesktopBeforeQuitOptions {
  invalidateStartupReporting?(): void;
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
  let invalidatingStartupReporting = false;

  return async (event) => {
    // Disposing the reporting owner can synchronously re-enter before-quit.
    if (!invalidatingStartupReporting) {
      invalidatingStartupReporting = true;
      try {
        const result: unknown = options.invalidateStartupReporting?.();
        if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
      } catch {
        // The owner latches closure first; reporting failure must not skip shutdown.
      } finally {
        invalidatingStartupReporting = false;
      }
    }
    if (options.readLifecycle()?.deferQuitForInstallerHandoff?.()) {
      event.preventDefault();
      return;
    }
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
    if (!options.readLifecycle()?.deferQuitForInstallerHandoff?.()) {
      options.quitApplication();
    }
  };
}
