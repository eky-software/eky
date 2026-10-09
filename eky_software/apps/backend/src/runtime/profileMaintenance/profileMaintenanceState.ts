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

interface MaintenanceOperation {
  operationId: string;
  kind: 'ordinary' | 'update';
  invalidated: boolean;
  updateValidUntil: number | undefined;
}

export class ProfileMaintenanceState {
  private activeBusinessWriteCount = 0;
  private activeOperation: MaintenanceOperation | undefined;
  private readonly drainWaiters = new Set<DrainWaiter>();

  async begin(operationId: string, timeoutMilliseconds: number): Promise<void> {
    await this.beginOperation(operationId, timeoutMilliseconds, 'ordinary');
  }

  async beginUpdate(
    operationId: string,
    timeoutMilliseconds: number,
    maximumDurationMilliseconds: number,
  ): Promise<void> {
    if (
      !Number.isFinite(maximumDurationMilliseconds) ||
      maximumDurationMilliseconds <= 0
    ) {
      throw new ProfileMaintenanceOperationMismatchError();
    }
    const operation = await this.beginOperation(
      operationId, timeoutMilliseconds, 'update',
    );
    if (this.activeOperation !== operation || operation.invalidated) {
      throw new ProfileMaintenanceOperationMismatchError();
    }
    operation.updateValidUntil = performance.now() + maximumDurationMilliseconds;
  }

  assertUpdate(operationId: string): void {
    const operation = this.activeOperation;
    if (
      operation?.kind === 'update' &&
      operation.updateValidUntil !== undefined &&
      performance.now() >= operation.updateValidUntil
    ) {
      this.forceEnd();
    }
    if (
      operation?.kind !== 'update' || operation.operationId !== operationId ||
      operation.invalidated || operation.updateValidUntil === undefined ||
      this.activeBusinessWriteCount !== 0
    ) {
      throw new ProfileMaintenanceOperationMismatchError();
    }
  }

  endUpdate(operationId: string): void {
    this.assertUpdate(operationId);
    this.activeOperation = undefined;
  }

  private async beginOperation(
    operationId: string,
    timeoutMilliseconds: number,
    kind: MaintenanceOperation['kind'],
  ): Promise<MaintenanceOperation> {
    if (this.activeOperation !== undefined) {
      throw new ProfileMaintenanceBusyError();
    }

    const operation: MaintenanceOperation = {
      operationId,
      kind,
      invalidated: false,
      updateValidUntil: undefined,
    };
    this.activeOperation = operation;

    if (this.activeBusinessWriteCount === 0) {
      return operation;
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
      if (this.activeOperation !== operation || operation.invalidated) {
        throw new ProfileMaintenanceOperationMismatchError();
      }
      return operation;
    } catch (error) {
      if (this.activeOperation === operation) {
        if (kind === 'update') {
          operation.invalidated = true;
        } else {
          this.activeOperation = undefined;
        }
      }
      throw error;
    }
  }

  end(operationId: string): void {
    if (
      this.activeOperation?.operationId !== operationId ||
      this.activeOperation.kind !== 'ordinary'
    ) {
      throw new ProfileMaintenanceOperationMismatchError();
    }

    this.activeOperation = undefined;
  }

  forceEnd(): void {
    if (this.activeOperation?.kind === 'update') {
      // Losing update ownership must never reopen the snapshot's write window.
      this.activeOperation.invalidated = true;
    } else {
      this.activeOperation = undefined;
    }
    this.rejectDrainWaiters();
  }

  getStatus(): ProfileMaintenanceStatus {
    return this.activeOperation === undefined ? 'normal' : 'busy';
  }

  isActiveOperation(operationId: string): boolean {
    if (this.activeOperation?.kind === 'update') {
      try {
        this.assertUpdate(operationId);
      } catch {
        return false;
      }
    }
    return this.activeOperation?.operationId === operationId;
  }

  tryBeginBusinessWrite(): ReleaseBusinessWrite | undefined {
    if (this.activeOperation !== undefined) {
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
