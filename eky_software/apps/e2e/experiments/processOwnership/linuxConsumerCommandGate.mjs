import { spawn } from 'node:child_process';
import { waitWithin } from './pidNamespaceContract.mjs';

const failure = () => new Error('E2E_LINUX_CONSUMER_COMMAND_GATE_UNVERIFIED');
const validExit = (code, signal) => (Number.isInteger(code) && code >= 0 && signal === null) ||
  (code === null && typeof signal === 'string' && signal.length > 0);

// Observes direct command handles only. The managers retain all cleanup authority.
export function createLinuxConsumerCommandGate({ spawnChild = spawn } = {}) {
  const pending = new Set();
  const observed = new WeakSet();
  let spawning = 0;
  let sealAttempted = false;
  let sealed = false;
  let poisoned = false;
  const poison = () => { poisoned = true; };

  const register = child => {
    if (!child || typeof child.on !== 'function' || observed.has(child)) {
      poison();
      throw failure();
    }
    observed.add(child);
    let resolve;
    const handle = { completion: new Promise(done => { resolve = done; }) };
    pending.add(handle);
    let spawned = false;
    let exited = false;
    let closed = false;
    let exitCode;
    let exitSignal;
    const streams = [{ ended: false, closed: false }, { ended: false, closed: false }];
    const settle = () => {
      if (closed && streams.every(stream => stream.ended && stream.closed)) {
        pending.delete(handle);
        resolve();
      }
    };
    try {
      child.on('error', poison);
      child.on('spawn', () => {
        if (spawned || exited || closed) poison();
        spawned = true;
      });
      child.on('exit', (code, signal) => {
        if (!spawned || exited || closed || !validExit(code, signal)) poison();
        exited = true;
        exitCode = code;
        exitSignal = signal;
      });
      child.on('close', (code, signal) => {
        if (!spawned || !exited || closed || code !== exitCode || signal !== exitSignal) poison();
        closed = true;
        settle();
      });
      if (child.stdout === child.stderr) poison();
      for (const [index, name] of ['stdout', 'stderr'].entries()) {
        const stream = child[name];
        const state = streams[index];
        if (!stream || typeof stream.on !== 'function') { poison(); continue; }
        stream.on('error', poison);
        stream.on('end', () => {
          if (state.ended || state.closed) poison();
          state.ended = true;
          settle();
        });
        stream.on('close', () => {
          if (!state.ended || state.closed) poison();
          state.closed = true;
          settle();
        });
      }
    } catch {
      // Still return the retained child to its cleanup owner if observation fails.
      poison();
    }
  };

  return Object.freeze({
    spawnChild(...args) {
      if (sealAttempted) { poison(); throw failure(); }
      spawning++;
      try {
        const child = spawnChild(...args);
        register(child);
        return child;
      } catch {
        poison();
        throw failure();
      } finally {
        spawning--;
      }
    },
    async drain(deadline, phase = 'wrapper') {
      try {
        deadline.check(phase);
        // Re-snapshot after every wait: cleanup may have launched another command.
        while (pending.size > 0) {
          await waitWithin(Promise.all([...pending].map(handle => handle.completion)), deadline, phase);
        }
        deadline.check(phase);
        if (poisoned || spawning !== 0) throw failure();
      } catch (error) {
        poison();
        throw error;
      }
    },
    seal() {
      sealAttempted = true;
      if (poisoned || spawning !== 0 || pending.size !== 0) { poison(); throw failure(); }
      sealed = true;
    },
    verifySealed() {
      if (!sealed || poisoned || spawning !== 0 || pending.size !== 0) throw failure();
    },
    get pendingCount() { return pending.size; },
  });
}
