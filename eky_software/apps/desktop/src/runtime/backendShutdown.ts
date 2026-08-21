export interface BackendShutdownProcess {
  kill(): boolean;
  once(event: 'exit', listener: () => void): unknown;
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
): Promise<'exited' | 'forced'> {
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

    processHandle.once('exit', () => {
      if (phase === 'settled') {
        return;
      }
      const outcome = phase === 'forced' ? 'forced' : 'exited';
      phase = 'settled';
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(outcome);
    });

    timer = setTimeout(handleGracefulTimeout, options.timeoutMilliseconds);
  });
}
