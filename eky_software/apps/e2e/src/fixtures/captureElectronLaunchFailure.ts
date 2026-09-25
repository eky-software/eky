import {
  captureElectronBackendStartupLogs,
  type ElectronBackendStartupLogsCapture,
} from './captureElectronBackendStartupLogs.js';
import {
  captureElectronStartupObservation,
  type ElectronLaunchObservation,
  type ElectronStartupCapture,
} from './launchElectronRuntime.js';

// Capture once at the launch failure boundary, before fixture cleanup can
// append shutdown events, remove the logs or start another runtime generation.
export function createElectronLaunchFailureCapture() {
  let requested = false;
  let backendStartupLogs: ElectronBackendStartupLogsCapture =
    Object.freeze({ status: 'notRequested' });
  let finishStartup: () => ElectronStartupCapture =
    () => Object.freeze({ status: 'notRequested' });

  return {
    observe(
      observation: ElectronLaunchObservation,
      runtime: Parameters<typeof captureElectronBackendStartupLogs>[0],
      readStartup: () => Promise<unknown>,
    ): void {
      if (observation.status !== 'failed' || requested) return;
      requested = true;
      finishStartup = captureElectronStartupObservation(readStartup);
      backendStartupLogs = captureElectronBackendStartupLogs(runtime);
    },
    finish() {
      return Object.freeze({
        startupCapture: finishStartup(),
        backendStartupLogs,
      });
    },
  };
}
