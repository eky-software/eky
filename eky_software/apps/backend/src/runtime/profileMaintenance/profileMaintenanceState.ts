export type ProfileMaintenanceStatus = 'busy' | 'normal';

export type ReleaseBusinessWrite = () => void;

export class ProfileMaintenanceBusyError extends Error {
  constructor() {
    super('Profile maintenance is already active.');
    this.name = 'ProfileMaintenanceBusyError';
  }
}

export class ProfileMaintenanceTimeoutError extends Error {
  constructor() {
    super('Profile maintenance could not start before the timeout.');
    this.name = 'ProfileMaintenanceTimeoutError';
  }
}

export class ProfileMaintenanceOperationMismatchError extends Error {
  constructor() {
    super('Profile maintenance operation does not match.');
    this.name = 'ProfileMaintenanceOperationMismatchError';
  }
}

interface DrainWaiter {
  reject(error: Error): void;
  resolve(): void;
  timer: ReturnType<typeof setTimeout>;
}

export class ProfileMaintenanceState {
  private activeBusinessWriteCount = 0;
  private activeOperationId: string | undefined;
  private readonly drainWaiters = new Set<DrainWaiter>();

  async begin(operationId: string, timeoutMilliseconds: number): Promise<void> {
    if (this.activeOperationId !== undefined) {
      throw new ProfileMaintenanceBusyError();
    }

    this.activeOperationId = operationId;

    if (this.activeBusinessWriteCount === 0) {
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const waiter: DrainWaiter = {
          reject,
          resolve,
          timer: setTimeout(() => {
            this.drainWaiters.delete(waiter);
            reject(new ProfileMaintenanceTimeoutError());
          }, timeoutMilliseconds),
        };
        this.drainWaiters.add(waiter);
      });
    } catch (error) {
      if (this.activeOperationId === operationId) {
        this.activeOperationId = undefined;
      }
      throw error;
    }
  }

  end(operationId: string): void {
    if (this.activeOperationId !== operationId) {
      throw new ProfileMaintenanceOperationMismatchError();
    }

    this.activeOperationId = undefined;
  }

  forceEnd(): void {
    this.activeOperationId = undefined;
    this.rejectDrainWaiters();
  }

  getStatus(): ProfileMaintenanceStatus {
    return this.activeOperationId === undefined ? 'normal' : 'busy';
  }

  isActiveOperation(operationId: string): boolean {
    return this.activeOperationId === operationId;
  }

  tryBeginBusinessWrite(): ReleaseBusinessWrite | undefined {
    if (this.activeOperationId !== undefined) {
      return undefined;
    }

    this.activeBusinessWriteCount += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeBusinessWriteCount -= 1;

      if (this.activeBusinessWriteCount === 0) {
        this.resolveDrainWaiters();
      }
    };
  }

  private resolveDrainWaiters(): void {
    for (const waiter of this.drainWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.drainWaiters.clear();
  }

  private rejectDrainWaiters(): void {
    for (const waiter of this.drainWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new ProfileMaintenanceOperationMismatchError());
    }
    this.drainWaiters.clear();
  }
}
