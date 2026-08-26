import type { ManagedChildProcess } from '../environment/startManagedProcess.js';
import { stopManagedProcessTree } from '../environment/stopManagedProcessTree.js';

interface ClosableElectronRuntime {
  close(): Promise<void>;
}

type ProcessTreeStopper = (process: ManagedChildProcess) => Promise<void>;

export async function closeOwnedElectronRuntime(
  runtime: ClosableElectronRuntime,
  process: ManagedChildProcess,
  stopProcessTree: ProcessTreeStopper = stopManagedProcessTree,
): Promise<void> {
  let runtimeCloseFailed = false;
  try {
    await runtime.close();
  } catch {
    runtimeCloseFailed = true;
  }

  try {
    await stopProcessTree(process);
  } catch {
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
