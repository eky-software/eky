import type { ManagedChildProcess } from '../environment/startManagedProcess.js';
import { stopManagedProcessTree } from '../environment/stopManagedProcessTree.js';

interface ClosableElectronRuntime {
  close(): Promise<void>;
}

type ProcessTreeStopper = (process: ManagedChildProcess) => Promise<void>;

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
