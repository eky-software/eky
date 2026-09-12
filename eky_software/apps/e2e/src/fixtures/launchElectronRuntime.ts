import { errors, type ElectronApplication, type Page } from '@playwright/test';

import { ELECTRON_E2E_FIRST_WINDOW_TIMEOUT_MILLISECONDS } from './electronLaunchBudgets.js';

export interface ElectronLaunchObservation {
  readonly phase: 'playwrightConnect' | 'firstWindow' | 'domContentLoaded';
  readonly status: 'started' | 'completed' | 'failed';
  readonly reason: 'none' | 'timeout' | 'processExited' | 'pageClosed' | 'unknown';
}

// Playwright owns connection startup. The fixture owns the returned runtime,
// including failures after connection; this function adds no cleanup owner.
export async function launchElectronRuntime(input: {
  launch(): Promise<ElectronApplication>;
  connected(
    application: ElectronApplication,
    process: ReturnType<ElectronApplication['process']>,
  ): void;
  observe(observation: ElectronLaunchObservation): void;
}): Promise<{ electronApp: ElectronApplication; page: Page }> {
  let phase: ElectronLaunchObservation['phase'] = 'playwrightConnect';
  let application: ElectronApplication | undefined;
  let child: ReturnType<ElectronApplication['process']> | undefined;
  let page: Page | undefined;
  const observe = (
    status: ElectronLaunchObservation['status'],
    reason: ElectronLaunchObservation['reason'] = 'none',
  ) => {
    try {
      input.observe(Object.freeze({ phase, status, reason }));
    } catch {
      // Optional diagnostics do not control readiness or cleanup.
    }
  };

  try {
    observe('started');
    application = await input.launch();
    child = application.process();
    if (child === undefined) {
      throw new Error('E2E_ELECTRON_PROCESS_HANDLE_UNAVAILABLE');
    }
    input.connected(application, child);
    observe('completed');

    phase = 'firstWindow';
    observe('started');
    page = await application.firstWindow({
      timeout: ELECTRON_E2E_FIRST_WINDOW_TIMEOUT_MILLISECONDS,
    });
    observe('completed');

    phase = 'domContentLoaded';
    observe('started');
    await page.waitForLoadState('domcontentloaded');
    observe('completed');
    return { electronApp: application, page };
  } catch (error) {
    const reason: ElectronLaunchObservation['reason'] =
      child !== undefined && (child.exitCode !== null || child.signalCode !== null)
        ? 'processExited'
        : page?.isClosed() === true
          ? 'pageClosed'
          : error instanceof errors.TimeoutError
            ? 'timeout'
            : 'unknown';
    observe('failed', reason);
    throw new Error(`E2E_ELECTRON_STARTUP_FAILED phase=${phase} reason=${reason}`);
  }
}
