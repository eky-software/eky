import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { encodeWorkspacePhaseObservation } from './workspacePhaseObservation.mjs';

const CHILD_PATH = fileURLToPath(new URL('./workspacePhaseWriterChild.mjs', import.meta.url));
export const WORKSPACE_PHASE_QUEUE_CAPACITY = 16;

export function createWorkspacePhaseWriter({
  timeoutMilliseconds, terminationTimeoutMilliseconds, signal, spawnProcess = spawn,
}) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error('WINDOWS_ACCEPTANCE_PHASE_WRITER_REQUEST_INVALID');
  }
  const cancellation = new AbortController();
  const queue = [];
  let input = null;
  let inFlight = false;
  let stopped = false;
  let channelFailed = false;
  let dropped = false;
  let attempted = false;
  let finishPromise = null;

  function dropPending() {
    dropped ||= inFlight || queue.length > 0;
    queue.length = 0;
  }

  function stopSending() {
    stopped = true;
    dropPending();
    input?.destroy();
  }

  function cancel() {
    stopSending();
    cancellation.abort();
  }

  if (signal?.aborted) cancel();
  const completion = runBoundedWindowsAdapterProcess({
    command: process.execPath, arguments: [CHILD_PATH], cwd: dirname(CHILD_PATH),
    timeoutMilliseconds, terminationTimeoutMilliseconds, signal: cancellation.signal,
    spawnProcess(command, args, options) {
      const child = spawnProcess(command, args, { ...options, stdio: ['pipe', 1, 'ignore'], shell: false });
      input = child.stdin;
      input.on('error', () => { channelFailed = true; stopSending(); });
      input.on('close', () => {
        if (!stopped) { channelFailed = true; stopSending(); }
      });
      return child;
    },
  }).then((result) => {
    signal?.removeEventListener('abort', cancel);
    if (result.resultCode !== 'cancelled') channelFailed ||= attempted;
    stopSending();
    return result;
  });
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();

  function pump() {
    if (stopped || inFlight || queue.length === 0) return;
    const bytes = queue.shift();
    inFlight = true;
    try {
      input.write(bytes, (error) => {
        inFlight = false;
        if (error) { channelFailed = true; stopSending(); }
        else pump();
      });
    } catch {
      inFlight = false;
      channelFailed = true;
      stopSending();
    }
  }

  return Object.freeze({
    send(value) {
      let bytes;
      try { bytes = encodeWorkspacePhaseObservation(value); }
      catch { dropped = true; return false; }
      attempted = true;
      if (stopped || queue.length === WORKSPACE_PHASE_QUEUE_CAPACITY) {
        dropped = true;
        return false;
      }
      queue.push(bytes);
      pump();
      return true;
    },
    finish() {
      if (finishPromise === null) {
        cancel();
        finishPromise = completion.then((processResult) => Object.freeze({
          diagnosticResultCode: channelFailed ? 'channelFailed' : dropped ? 'messagesDropped'
            : attempted ? 'deliveryUnverified' : 'notSent',
          writerResultCode: processResult.directProcessAbsent ? 'writerAbsent' : 'writerExitUnverified',
          processResult,
        }));
      }
      return finishPromise;
    },
  });
}
