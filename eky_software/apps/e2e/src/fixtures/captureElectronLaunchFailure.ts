import {
  captureElectronBackendStartupLogs,
  type ElectronBackendStartupLogsCapture,
} from './captureElectronBackendStartupLogs.js';
import {
  captureElectronStartupObservation,
  type ElectronLaunchObservation,
  type ElectronStartupCapture,
} from './launchElectronRuntime.js';
import {
  captureElectronNativeStartupFailure,
  type ElectronNativeStartupFailureCapture,
} from './captureElectronNativeStartupFailure.js';
import type { OwnedWindowsElectronBridge } from '../environment/startOwnedWindowsElectronBridge.js';

export interface ElectronFirstLaunchFailure {
  readonly startupGeneration: number | null;
  readonly phase: ElectronLaunchObservation['phase'];
  readonly reason: ElectronLaunchObservation['reason'];
}

export function readObservedElectronLaunchExitCode(
  owner: (Pick<OwnedWindowsElectronBridge, 'readObservedWorkloadState'> & {
    workload: Pick<OwnedWindowsElectronBridge['workload'], 'readExitCode'>;
  }) | undefined,
): number | null {
  try {
    return owner?.readObservedWorkloadState() === 'exited' ? owner.workload.readExitCode() : null;
  } catch {
    return null;
  }
}

// Capture once at the launch failure boundary, before fixture cleanup can
// append shutdown events, remove the logs or start another runtime generation.
export function createElectronLaunchFailureCapture() {
  let requested = false;
  let backendStartupLogs: ElectronBackendStartupLogsCapture =
    Object.freeze({ status: 'notRequested' });
  let finishStartup: () => ElectronStartupCapture =
    () => Object.freeze({ status: 'notRequested' });
  let nativeStartupFailure: ElectronNativeStartupFailureCapture = Object.freeze({ status: 'notRequested' });
  let launchExitCode: number | null = null;
  let firstLaunchFailure: Readonly<ElectronFirstLaunchFailure> | null = null;

  return {
    observe(
      observation: ElectronLaunchObservation,
      runtime: Parameters<typeof captureElectronBackendStartupLogs>[0] & {
        artifactsRoot?: string;
        startupGeneration?: number;
      },
      readStartup: () => Promise<unknown>,
      observedExitCode?: number | null,
    ): void {
      if (observation.status !== 'failed' || requested) return;
      requested = true;
      firstLaunchFailure = Object.freeze({
        startupGeneration: typeof runtime.startupGeneration === 'number' &&
          Number.isSafeInteger(runtime.startupGeneration) && runtime.startupGeneration > 0
          ? runtime.startupGeneration : null,
        phase: observation.phase,
        reason: observation.reason,
      });
      // Only the synchronous pre-cleanup observation; never the code caused by teardown.
      launchExitCode = typeof observedExitCode === 'number' && Number.isInteger(observedExitCode) &&
        observedExitCode >= -0x80000000 && observedExitCode <= 0x7fffffff ? observedExitCode : null;
      finishStartup = captureElectronStartupObservation(readStartup);
      backendStartupLogs = captureElectronBackendStartupLogs(runtime);
      if (runtime.artifactsRoot !== undefined) {
        nativeStartupFailure = captureElectronNativeStartupFailure({
          runRoot: runtime.runRoot, artifactsRoot: runtime.artifactsRoot,
          runtimeInstanceId: runtime.runtimeInstanceId,
        });
      }
    },
    finish() {
      return Object.freeze({
        startupCapture: finishStartup(),
        backendStartupLogs,
        nativeStartupFailure,
        launchExitCode,
        firstLaunchFailure,
      });
    },
  };
}
