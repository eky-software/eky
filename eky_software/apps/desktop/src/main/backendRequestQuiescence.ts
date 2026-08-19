const defaultQuiescenceTimeoutMilliseconds = 30_000;

export type BackendRequestQuiescenceState =
  | 'active'
  | 'quiescing'
  | 'stopped';

export interface BackendRequestLease {
  release(): void;
}

export interface BackendRequestAdmission {
  begin(method: string): BackendRequestLease | undefined;
}

export class BackendRequestQuiescenceTimeoutError extends Error {
  constructor() {
    super('BACKEND_REQUEST_QUIESCENCE_TIMEOUT');
    this.name = 'BackendRequestQuiescenceTimeoutError';
  }
}

export class BackendRequestQuiescence
  implements BackendRequestAdmission
{
  private activeMutationCount = 0;
  private readonly quiescenceTimeoutMilliseconds: number;
  private state: BackendRequestQuiescenceState = 'active';
  private waiters = new Set<() => void>();

  constructor(options: { timeoutMilliseconds?: number } = {}) {
    const timeoutMilliseconds =
      options.timeoutMilliseconds ?? defaultQuiescenceTimeoutMilliseconds;
    if (
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 1
    ) {
      throw new Error('BACKEND_REQUEST_QUIESCENCE_INVALID');
    }
    this.quiescenceTimeoutMilliseconds = timeoutMilliseconds;
  }

  begin(method: string): BackendRequestLease | undefined {
    const mutation = !isReadMethod(method);
    if (
      this.state === 'stopped' ||
      (this.state === 'quiescing' && mutation)
    ) {
      return undefined;
    }
    if (!mutation) {
      return { release() {} };
    }

    this.activeMutationCount += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeMutationCount -= 1;
        if (this.activeMutationCount === 0) {
          const waiters = this.waiters;
          this.waiters = new Set();
          for (const resolve of waiters) resolve();
        }
      },
    };
  }

  async quiesceAndWait(): Promise<void> {
    if (this.state === 'stopped') {
      throw new Error('BACKEND_REQUEST_QUIESCENCE_STOPPED');
    }
    this.state = 'quiescing';
    if (this.activeMutationCount === 0) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.waiters.delete(complete);
        resolve();
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.waiters.delete(complete);
        reject(new BackendRequestQuiescenceTimeoutError());
      }, this.quiescenceTimeoutMilliseconds);
      this.waiters.add(complete);
    });
  }

  resume(): void {
    if (this.state === 'stopped') {
      throw new Error('BACKEND_REQUEST_QUIESCENCE_STOPPED');
    }
    this.state = 'active';
  }

  stop(): void {
    this.state = 'stopped';
  }

  readState(): BackendRequestQuiescenceState {
    return this.state;
  }
}

function isReadMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}
