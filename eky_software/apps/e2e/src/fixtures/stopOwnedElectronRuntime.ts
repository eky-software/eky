import type { ManagedChildProcess } from '../environment/startManagedProcess.js';
import {
  stopManagedProcessTree,
  waitForManagedProcessExit,
} from '../environment/stopManagedProcessTree.js';
import { ELECTRON_E2E_GRACEFUL_EXIT_SAFETY_TIMEOUT_MILLISECONDS } from './electronLaunchBudgets.js';

interface ClosableElectronRuntime {
  close(): Promise<void>;
}

type ProcessTreeStopper = (process: ManagedChildProcess) => Promise<void>;
type ProcessExitWaiter = (
  process: ManagedChildProcess,
  timeoutMilliseconds: number,
) => Promise<boolean>;

export async function closeOwnedElectronRuntime(
  runtime: ClosableElectronRuntime,
  process: ManagedChildProcess,
  stopProcessTree: ProcessTreeStopper = stopManagedProcessTree,
  waitForProcessExit: ProcessExitWaiter = waitForManagedProcessExit,
): Promise<void> {
  let runtimeCloseFailed = false;
  try {
    await runtime.close();
  } catch {
    runtimeCloseFailed = true;
  }

  let processExitWaitFailed = false;
  if (!runtimeCloseFailed) {
    try {
      await waitForProcessExit(
        process,
        ELECTRON_E2E_GRACEFUL_EXIT_SAFETY_TIMEOUT_MILLISECONDS,
      );
    } catch {
      processExitWaitFailed = true;
    }
  }

  try {
    await stopProcessTree(process);
  } catch {
    throw new Error('Electron E2E runtime process cleanup failed.');
  }
  if (processExitWaitFailed) {
    throw new Error('Electron E2E runtime process cleanup failed.');
  }
  if (runtimeCloseFailed) {
    throw new Error('Electron E2E runtime handle cleanup failed.');
  }
}

export async function stopOwnedElectronRuntime(
  runtime: ClosableElectronRuntime,
  process: ManagedChildProcess,
  stopProcessTree: ProcessTreeStopper = stopManagedProcessTree,
): Promise<void> {
  let processStopFailed = false;
  try {
    await stopProcessTree(process);
  } catch {
    processStopFailed = true;
  }

  await runtime.close().catch(() => undefined);
  if (processStopFailed) {
    throw new Error('Electron E2E runtime process cleanup failed.');
  }
}
