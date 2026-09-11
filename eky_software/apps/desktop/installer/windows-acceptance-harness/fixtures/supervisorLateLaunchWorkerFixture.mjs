import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workerData } from 'node:worker_threads';
import { launchSupervisorInThread } from '../supervisorProcessLaunchWorker.mjs';

launchSupervisorInThread((command, args, options) => {
  const child = spawn(command, args, options);
  // Hold the real handle across the caller's deadline; no permit has been sent.
  if (workerData.nativeWait) {
    // Model an unreturned native call, not the cause of any particular CI hang.
    // The existing outer contract Job owns this synthetic blocking descendant.
    spawnSync(process.execPath, [fileURLToPath(new URL('../legacyCommandWorkerFixture.mjs', import.meta.url)), 'hold'],
      { stdio: 'ignore', windowsHide: true });
  } else {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.delayMilliseconds);
  }
  return child;
});
