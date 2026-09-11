import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };

export const SUPERVISOR_EXIT_RESERVE_MS = commandBudgets.exitReserveMilliseconds;

export function spawnSupervisorProcess(command, args, options, { createWorker = (url, input) => new Worker(url, input) } = {}) {
  const state = new Int32Array(new SharedArrayBuffer(4));
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.spawnPending = true;
  let closed = null;
  let errorSeen = false;
  const worker = createWorker(new URL('./supervisorProcessLaunchWorker.mjs', import.meta.url), {
    workerData: { command, args, options, state: state.buffer },
  });
  child.kill = () => {
    Atomics.exchange(state, 0, 2);
    worker.postMessage('cancel');
    return true;
  };
  child.unref = () => worker.unref();
  worker.on('message', (message) => {
    if (message.type === 'spawn') {
      child.spawnPending = false;
      child.emit('spawn');
    } else if (message.type === 'exit') {
      child.exitCode = message.code;
      child.signalCode = message.signal;
      child.emit('exit', message.code, message.signal);
    } else if (message.type === 'close') {
      closed = message;
    } else if (message.type === 'error') {
      errorSeen = true;
      child.emit('error', new Error('supervisorProcessError'));
    }
  });
  worker.on('error', () => {
    errorSeen = true;
    child.emit('error', new Error('supervisorLaunchThreadFailed'));
  });
  worker.once('exit', (code) => {
    if (code === 0 && closed !== null) {
      child.spawnPending = false;
      child.emit('close', closed.code, closed.signal);
    } else if (!errorSeen) {
      child.emit('error', new Error('supervisorLaunchThreadUnverified'));
    }
  });
  return child;
}
