import { errors, type ElectronApplication, type Page } from '@playwright/test';
import { ElectronBridgeCallerFailure, type ElectronBridgeFailureReason } from '../environment/startOwnedWindowsElectronBridge.js';

import { ELECTRON_E2E_FIRST_WINDOW_TIMEOUT_MILLISECONDS } from './electronLaunchBudgets.js';
import {
  parseElectronE2eStartupObservation,
  type ElectronE2eStartupObservation,
} from '../../../desktop/e2e/electronE2eStartupObservation.js';

export type ElectronStartupCapture =
  | Readonly<{ status: 'notRequested' | 'unavailable' }>
  | Readonly<{ status: 'captured'; observation: ElectronE2eStartupObservation }>;

// The fixture's existing channel cleanup owns pending evaluation. Never wait
// for this optional read, and never accept a late result after reporting.
export function captureElectronStartupObservation(
  read: () => Promise<unknown>,
): () => ElectronStartupCapture {
  let sealed = false;
  let result: ElectronStartupCapture = Object.freeze({ status: 'unavailable' });
  try {
    void read().then((value) => {
      if (sealed) return;
      const observation = parseElectronE2eStartupObservation(value);
      if (observation !== undefined) {
        result = Object.freeze({ status: 'captured', observation });
      }
    }).catch(() => undefined);
  } catch {
    // A missing or failed diagnostic cannot replace the launch failure.
  }
  return () => {
    sealed = true;
    return result;
  };
}

export interface ElectronLaunchObservation {
  readonly phase: 'playwrightConnect' | 'firstWindow' | 'domContentLoaded';
  readonly status: 'started' | 'completed' | 'failed';
  readonly reason: 'none' | 'processExited' | 'pageClosed' | ElectronBridgeFailureReason;
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
  readWorkloadState?(): 'running' | 'exited' | 'unavailable';
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
    let processExited = false;
    if (phase !== 'playwrightConnect' && input.readWorkloadState !== undefined) {
      // A Playwright bridge exit is not an Electron workload exit. Observe
      // the actual owner before fixture cleanup can change the workload.
      try { processExited = input.readWorkloadState() === 'exited'; }
      catch { /* Missing diagnostics cannot replace the original failure. */ }
    } else if (input.readWorkloadState === undefined) {
      processExited = child !== undefined && (child.exitCode !== null || child.signalCode !== null);
    }
    const reason: ElectronLaunchObservation['reason'] =
      processExited
        ? 'processExited'
        : page?.isClosed() === true
          ? 'pageClosed'
          : error instanceof errors.TimeoutError
            ? 'timeout'
            : error instanceof ElectronBridgeCallerFailure ? error.reason : 'unknown';
    observe('failed', reason);
    throw new Error(`E2E_ELECTRON_STARTUP_FAILED phase=${phase} reason=${reason}`);
  }
}
