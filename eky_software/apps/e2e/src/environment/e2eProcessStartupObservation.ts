import type { ChildProcess } from 'node:child_process';

export type E2eProcessStartupTerminal = 'exited' | 'spawnFailed' | 'observationLost';

export interface E2eProcessStartupState {
  readonly spawnObserved: boolean;
  readonly terminal: E2eProcessStartupTerminal | undefined;
}

// This observes the workload, not an owner/bridge or the whole process tree.
export interface E2eProcessStartupObservation {
  readState(): E2eProcessStartupState;
  // Register first, then readState synchronously to include earlier observations.
  subscribe(listener: (state: E2eProcessStartupState) => void): () => void;
}

// Attach synchronously after spawn(), before handing the actual child to callers.
export function observeChildProcessStartup(child: ChildProcess): E2eProcessStartupObservation {
  let state: E2eProcessStartupState = Object.freeze({
    spawnObserved: false,
    terminal: undefined,
  });
  const listeners = new Set<(state: E2eProcessStartupState) => void>();

  const publish = (next: E2eProcessStartupState) => {
    if (state.terminal !== undefined) return;
    state = Object.freeze(next);
    try {
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener(state);
      }
    } finally {
      if (state.terminal !== undefined) listeners.clear();
    }
  };
  const onSpawn = () => publish({ spawnObserved: true, terminal: undefined });
  const onExit = () => publish({ ...state, terminal: 'exited' });
  const onError = () => publish({
    ...state,
    terminal: state.spawnObserved ? 'observationLost' : 'spawnFailed',
  });
  const onClose = () => {
    try {
      publish({ ...state, terminal: 'observationLost' });
    } finally {
      listeners.clear();
      child.removeListener('spawn', onSpawn);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
    }
  };

  child.once('spawn', onSpawn);
  child.once('exit', onExit);
  // Keep the error observer through close, including errors after startup.
  child.on('error', onError);
  child.once('close', onClose);
  if (child.exitCode !== null || child.signalCode !== null) onExit();

  return Object.freeze({
    readState: () => state,
    subscribe(listener: (state: E2eProcessStartupState) => void) {
      if (state.terminal === undefined) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
}
