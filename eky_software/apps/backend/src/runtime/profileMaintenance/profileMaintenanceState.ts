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
  kind: 'ordinary' | 'update' | 'restore';
  invalidated: boolean;
  validUntil: number | undefined;
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
    await this.beginProtectedOperation(
      operationId, timeoutMilliseconds, maximumDurationMilliseconds, 'update',
    );
  }

  async beginRestore(
    operationId: string,
    timeoutMilliseconds: number,
    maximumDurationMilliseconds: number,
  ): Promise<void> {
    await this.beginProtectedOperation(
      operationId, timeoutMilliseconds, maximumDurationMilliseconds, 'restore',
    );
  }

  private async beginProtectedOperation(
    operationId: string,
    timeoutMilliseconds: number,
    maximumDurationMilliseconds: number,
    kind: 'update' | 'restore',
  ): Promise<void> {
    if (
      !Number.isFinite(maximumDurationMilliseconds) ||
      maximumDurationMilliseconds <= 0
    ) {
      throw new ProfileMaintenanceOperationMismatchError();
    }
    const operation = await this.beginOperation(
      operationId, timeoutMilliseconds, kind,
    );
    if (this.activeOperation !== operation || operation.invalidated) {
      throw new ProfileMaintenanceOperationMismatchError();
    }
    operation.validUntil = performance.now() + maximumDurationMilliseconds;
  }

  assertUpdate(operationId: string): void {
    this.assertProtectedOperation(operationId, 'update');
  }

  assertRestore(operationId: string): void {
    this.assertProtectedOperation(operationId, 'restore');
  }

  private assertProtectedOperation(
    operationId: string,
    kind: 'update' | 'restore',
  ): void {
    const operation = this.activeOperation;
    if (
      operation?.kind !== 'ordinary' &&
      operation?.validUntil !== undefined &&
      performance.now() >= operation.validUntil
    ) {
      this.forceEnd();
    }
    if (
      operation?.kind !== kind || operation.operationId !== operationId ||
      operation.invalidated || operation.validUntil === undefined ||
      this.activeBusinessWriteCount !== 0
    ) {
      throw new ProfileMaintenanceOperationMismatchError();
    }
  }

  endUpdate(operationId: string): void {
    this.assertUpdate(operationId);
    this.activeOperation = undefined;
  }

  endRestore(operationId: string): void {
    this.assertRestore(operationId);
    this.activeOperation = undefined;
  }

  invalidateRestore(operationId: string): void {
    const operation = this.activeOperation;
    if (operation?.kind !== 'restore' || operation.operationId !== operationId) {
      throw new ProfileMaintenanceOperationMismatchError();
    }
    operation.invalidated = true;
    this.rejectDrainWaiters();
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
      validUntil: undefined,
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
        if (kind !== 'ordinary') {
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
    if (this.activeOperation !== undefined && this.activeOperation.kind !== 'ordinary') {
      // Losing protected ownership must never reopen the snapshot's write window.
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
    if (this.activeOperation !== undefined && this.activeOperation.kind !== 'ordinary') {
      try {
        this.assertProtectedOperation(operationId, this.activeOperation.kind);
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
