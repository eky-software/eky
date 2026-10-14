import type { PreparedProfileRestore } from './profileRestoreStagingService.js';

export interface PreparedProfileRestoreClaim {
  readonly prepared: PreparedProfileRestore;
  preserveForRecovery(): void;
  release(): void;
}

export class PreparedProfileRestoreBusyError extends Error {
  constructor() {
    super('PROFILE_RESTORE_BUSY');
    this.name = 'PreparedProfileRestoreBusyError';
  }
}

/** The prepared slot stops being discardable as soon as activation may own it. */
export class PreparedProfileRestoreOwner {
  private prepared: PreparedProfileRestore | undefined;
  private claimToken: symbol | undefined;
  private recoveryOwned = false;

  assertIdle(): void {
    if (this.claimToken !== undefined || this.recoveryOwned) {
      throw new PreparedProfileRestoreBusyError();
    }
  }

  assertCanStage(): void {
    this.assertIdle();
    if (this.prepared !== undefined) throw new PreparedProfileRestoreBusyError();
  }

  set(prepared: PreparedProfileRestore): PreparedProfileRestore {
    this.assertCanStage();
    this.prepared = Object.freeze({
      ...prepared,
      summary: Object.freeze({ ...prepared.summary }),
    });
    return this.prepared;
  }

  get(operationId: string): PreparedProfileRestore | undefined {
    return this.prepared?.operationId === operationId ? this.prepared : undefined;
  }

  clear(operationId: string): void {
    this.assertIdle();
    if (this.prepared?.operationId === operationId) this.prepared = undefined;
  }

  claim(operationId: string): PreparedProfileRestoreClaim | undefined {
    this.assertIdle();
    const prepared = this.get(operationId);
    if (prepared === undefined) return undefined;
    const token = Symbol();
    this.claimToken = token;
    return {
      prepared,
      preserveForRecovery: () => {
        if (this.claimToken !== token) throw new PreparedProfileRestoreBusyError();
        this.recoveryOwned = true;
        this.prepared = undefined;
      },
      release: () => {
        if (this.claimToken === token) this.claimToken = undefined;
      },
    };
  }
}
