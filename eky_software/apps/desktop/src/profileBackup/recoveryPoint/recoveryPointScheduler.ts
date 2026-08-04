import type { RecoveryPointCleanShutdownMarker } from './recoveryPointCleanShutdownMarker.js';
import type { RecoveryPointService } from './recoveryPointService.js';

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
      now?(): Date;
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
    const check = this.dependencies.recoveryPointService
      .checkAutomatic()
      .then(() => undefined)
      .catch(() => undefined)
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

export const recoveryPointCheckIntervalMilliseconds =
  defaultCheckIntervalMilliseconds;
