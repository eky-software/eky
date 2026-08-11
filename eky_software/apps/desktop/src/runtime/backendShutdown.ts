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

export function waitForBackendShutdown(
  processHandle: BackendShutdownProcess,
  options: {
    forceAfterTimeout: boolean;
    timeoutMilliseconds: number;
  },
): Promise<'exited' | 'forced'> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      if (!options.forceAfterTimeout) {
        reject(new BackendGracefulShutdownTimeoutError());
        return;
      }
      processHandle.kill();
      resolve('forced');
    }, options.timeoutMilliseconds);

    processHandle.once('exit', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve('exited');
    });
  });
}
