import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';

export const SUPERVISOR_EXIT_RESERVE_MS = 5_000;

export function startSupervisorInvocation({ command, arguments: args, cwd, timeoutMilliseconds,
  terminationTimeoutMilliseconds = SUPERVISOR_EXIT_RESERVE_MS, spawnProcess = spawnSupervisorProcess,
  observe = () => {} }) {
  const cancellation = new AbortController();
  let processHandle;
  const child = new EventEmitter();
  Object.defineProperties(child, {
    exitCode: { get: () => processHandle?.exitCode ?? null },
    signalCode: { get: () => processHandle?.signalCode ?? null },
  });
  child.kill = () => cancellation.abort();
  const completion = runBoundedWindowsAdapterProcess({
    command, arguments: args, cwd, timeoutMilliseconds: timeoutMilliseconds + terminationTimeoutMilliseconds,
    terminationTimeoutMilliseconds,
    signal: cancellation.signal,
    spawnProcess(executable, arguments_, options) {
      processHandle = spawnProcess(executable, arguments_, { ...options, stdio: 'inherit' });
      for (const [event, phase] of [['exit', 'supervisorExit'], ['close', 'supervisorClose']]) {
        processHandle.once(event, (code, signal) => {
          child.emit(event, code, signal);
          try { observe(phase, code === 0 && signal === null ? 'completed' : 'failed'); }
          catch { /* Optional observations do not settle process ownership. */ }
        });
      }
      return processHandle;
    },
  });
  return Object.freeze({ child, completion });
}

// This is the caller's exact supervisor handle, not an owner of its Job children.
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
