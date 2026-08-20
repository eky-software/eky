import { randomUUID } from 'node:crypto';

import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { RecoveryPointCleanShutdownMarker } from './recoveryPointCleanShutdownMarker.js';
import type { RecoveryPointService } from './recoveryPointService.js';
import type { WorkspaceMaintenanceLease } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';

const defaultCheckIntervalMilliseconds = 60 * 60 * 1_000;

export class RecoveryPointScheduler {
  private currentCheck: Promise<void> | undefined;
  private started = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly dependencies: {
      checkIntervalMilliseconds?: number;
      cleanShutdownMarker: Pick<
        RecoveryPointCleanShutdownMarker,
        'consume' | 'markClean'
      >;
      maintenanceLease: WorkspaceMaintenanceLease;
      correlationIdFactory?(): string;
      now?(): Date;
      observer?: ProfileRecoveryOperationalObserver;
      recoveryPointService: Pick<
        RecoveryPointService,
        'checkAutomatic'
      >;
    },
  ) {}

  async start(): Promise<'clean' | 'unclean'> {
    if (this.started) {
      throw new Error('RECOVERY_POINT_SCHEDULER_ALREADY_STARTED');
    }
    this.started = true;
    const previousShutdownState =
      await this.dependencies.cleanShutdownMarker.consume();
    await this.runCheck();
    this.timer = setInterval(() => {
      void this.runCheck();
    }, this.readCheckInterval());
    this.timer.unref?.();
    return previousShutdownState;
  }

  async stopChecks(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.currentCheck;
  }

  async markCleanShutdown(): Promise<void> {
    await this.stopChecks();
    await this.dependencies.cleanShutdownMarker.markClean(
      (this.dependencies.now?.() ?? new Date()).toISOString(),
    );
  }

  private runCheck(): Promise<void> {
    if (this.currentCheck !== undefined) {
      return this.currentCheck;
    }
    const correlationId =
      this.dependencies.correlationIdFactory?.() ?? randomUUID();
    const startedAt = Date.now();
    const check = this.dependencies.maintenanceLease
      .acquire('backup')
      .then(async (lease) => {
        try {
          return await this.dependencies.recoveryPointService.checkAutomatic(
            correlationId,
          );
        } finally {
          await lease.release();
        }
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        observeProfileRecoverySafely(
          this.dependencies.observer ??
            noOpProfileRecoveryOperationalObserver,
          {
            correlationId,
            durationMs: Date.now() - startedAt,
            errorCode: readSafeErrorCode(error),
            eventName: 'recoveryPoint.failed',
            retryable: true,
            sideEffectState: 'unknown',
            stage: 'automaticCheck',
          },
        );
      })
      .finally(() => {
        if (this.currentCheck === check) {
          this.currentCheck = undefined;
        }
      });
    this.currentCheck = check;
    return check;
  }

  private readCheckInterval(): number {
    const value =
      this.dependencies.checkIntervalMilliseconds ??
      defaultCheckIntervalMilliseconds;
    if (!Number.isSafeInteger(value) || value < 1_000) {
      throw new Error('RECOVERY_POINT_SCHEDULER_INVALID');
    }
    return value;
  }
}

function readSafeErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code)
  ) {
    return error.code;
  }
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'RECOVERY_POINT_AUTOMATIC_CHECK_FAILED';
}

export const recoveryPointCheckIntervalMilliseconds =
  defaultCheckIntervalMilliseconds;
