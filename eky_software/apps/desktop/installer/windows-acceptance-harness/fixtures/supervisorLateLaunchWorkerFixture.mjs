import { spawn } from 'node:child_process';
import { workerData } from 'node:worker_threads';
import { launchSupervisorInThread } from '../supervisorProcessLaunchWorker.mjs';

launchSupervisorInThread((command, args, options) => {
  const child = spawn(command, args, options);
  // Hold the real handle across the caller's deadline; no permit has been sent.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.delayMilliseconds);
  return child;
});
