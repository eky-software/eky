import { spawn } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export function launchSupervisorInThread(spawnProcess = spawn) {
  const state = new Int32Array(workerData.state);
  let child;
  let cancelled = false;
  function cancel() {
    if (cancelled) return;
    cancelled = true;
    child?.stdin?.destroy();
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill(); } catch { parentPort.postMessage({ type: 'error' }); }
    }
  }
  parentPort.on('message', (message) => { if (message === 'cancel') cancel(); });
  try {
    // The anonymous permit pipe prevents late native creation from starting work.
    const output = workerData.options.stdio === 'inherit' ? 'inherit' : 'ignore';
    child = spawnProcess(workerData.command, [...workerData.args, '--caller-admission'], {
      ...workerData.options, stdio: ['pipe', output, output], shell: false,
    });
    child.once('close', (code, signal) => {
      parentPort.postMessage({ type: 'close', code, signal });
      parentPort.close();
    });
    child.on('error', () => parentPort.postMessage({ type: 'error' }));
    child.once('exit', (code, signal) => parentPort.postMessage({ type: 'exit', code, signal }));
    child.stdin.on('error', () => { parentPort.postMessage({ type: 'error' }); cancel(); });
    child.once('spawn', () => {
      parentPort.postMessage({ type: 'spawn' });
      if (Atomics.compareExchange(state, 0, 0, 1) !== 0) cancel();
      else child.stdin.end(Buffer.from([1]));
    });
    if (Atomics.load(state, 0) === 2) cancel();
  } catch {
    // An unexpected launch exception cannot manufacture a process-close receipt.
    parentPort.postMessage({ type: 'error' });
    if (child) cancel();
    else parentPort.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) launchSupervisorInThread();
