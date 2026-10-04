export interface BackendShutdownProcess {
  kill(): boolean;
  once(event: 'exit', listener: (exitCode: number) => void): unknown;
}

export type BackendShutdownOutcome = 'exited' | 'forced';

export class BackendShutdownExitError extends Error {
  constructor() {
    super('The backend exited unsuccessfully during shutdown.');
    this.name = 'BackendShutdownExitError';
  }
}

export class BackendGracefulShutdownTimeoutError extends Error {
  constructor() {
    super('The backend did not stop gracefully within the allowed time.');
    this.name = 'BackendGracefulShutdownTimeoutError';
  }
}

export class BackendForcedShutdownTimeoutError extends Error {
  constructor() {
    super('The backend did not exit after forced termination.');
    this.name = 'BackendForcedShutdownTimeoutError';
  }
}

export function waitForBackendShutdown(
  processHandle: BackendShutdownProcess,
  options: {
    forceAfterTimeout: boolean;
    timeoutMilliseconds: number;
  },
): Promise<BackendShutdownOutcome> {
  return new Promise((resolve, reject) => {
    let phase: 'graceful' | 'forced' | 'settled' = 'graceful';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const rejectForcedShutdown = (): void => {
      if (phase !== 'forced') {
        return;
      }
      phase = 'settled';
      reject(new BackendForcedShutdownTimeoutError());
    };

    const handleGracefulTimeout = (): void => {
      if (phase !== 'graceful') {
        return;
      }
      if (!options.forceAfterTimeout) {
        phase = 'settled';
        reject(new BackendGracefulShutdownTimeoutError());
        return;
      }

      phase = 'forced';
      try {
        processHandle.kill();
      } catch {
        phase = 'settled';
        reject(new BackendForcedShutdownTimeoutError());
        return;
      }
      if (phase === 'forced') {
        timer = setTimeout(
          rejectForcedShutdown,
          options.timeoutMilliseconds,
        );
      }
    };

    processHandle.once('exit', (exitCode) => {
      if (phase === 'settled') {
        return;
      }
      const outcome = phase === 'forced' ? 'forced' : 'exited';
      phase = 'settled';
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (outcome === 'exited' && exitCode !== 0) {
        reject(new BackendShutdownExitError());
        return;
      }
      resolve(outcome);
    });

    timer = setTimeout(handleGracefulTimeout, options.timeoutMilliseconds);
  });
}
