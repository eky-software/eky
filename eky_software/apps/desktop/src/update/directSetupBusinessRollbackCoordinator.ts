import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { DirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import { transitionDirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import type { DirectSetupMigrationRecoveryStore } from './directSetupMigrationRecoveryStore.js';
import type { MigrationStartupInspection } from './firstStartUpdateCoordinator.js';
import type { UpdateProfileProtection } from './profileProtectionComposition.js';
import {
  noOpUpdateOperationalObserver,
  type UpdateOperationalObserver,
} from './updateOperationalObserver.js';

interface DirectSetupBusinessRollbackCoordinatorDependencies {
  now?(): Date;
  observer?: UpdateOperationalObserver;
  profileProtection: Pick<
    UpdateProfileProtection,
    'restoreRecoveryPoint' | 'validateActiveProfile'
  >;
  recoveryStore: Pick<DirectSetupMigrationRecoveryStore, 'read' | 'write'>;
  releaseInfo: Readonly<DesktopReleaseInfo>;
}

export class DirectSetupBusinessRollbackError extends Error {
  constructor() {
    super('The direct Setup business profile rollback requires recovery.');
    this.name = 'DirectSetupBusinessRollbackError';
  }
}

export class DirectSetupBusinessRollbackCoordinator {
  constructor(
    private readonly dependencies: DirectSetupBusinessRollbackCoordinatorDependencies,
  ) {}

  async startIfRequired(
    inspection?: Readonly<MigrationStartupInspection>,
  ): Promise<'notRequired' | 'relaunching' | 'validationRequired'> {
    const recovery = await this.dependencies.recoveryStore.read();
    if (
      recovery === undefined ||
      (recovery.state !== 'recoveryRequired' &&
        recovery.state !== 'businessRollbackStarting')
    ) {
      return 'notRequired';
    }

    this.assertRunningTarget(recovery);
    this.notifyStarted(recovery.correlationId);
    const starting =
      recovery.state === 'businessRollbackStarting'
        ? recovery
        : transitionDirectSetupMigrationRecovery(recovery, {
            at: this.now(),
            state: 'businessRollbackStarting',
          });
    if (starting !== recovery) {
      await this.dependencies.recoveryStore.write(starting);
    }

    if (profileMatchesProtectedPrefix(inspection, starting)) {
      return 'validationRequired';
    }

    try {
      return await this.dependencies.profileProtection.restoreRecoveryPoint({
        expectedMigrationChainIdentity: starting.migrationPrefixIdentity,
        operationId: starting.correlationId,
        recoveryPointReference: starting.recoveryPointReference,
      });
    } catch {
      await this.failSafe(starting);
      this.notifyFailed(starting.correlationId);
      throw new DirectSetupBusinessRollbackError();
    }
  }

  async completeAfterProfileValidation(input: {
    inspection: Readonly<MigrationStartupInspection>;
  }): Promise<void> {
    const recovery = await this.dependencies.recoveryStore.read();
    if (recovery?.state !== 'businessRollbackStarting') {
      throw new DirectSetupBusinessRollbackError();
    }
    this.assertRunningTarget(recovery);

    try {
      if (!profileMatchesProtectedPrefix(input.inspection, recovery)) {
        throw new DirectSetupBusinessRollbackError();
      }
      const validation =
        await this.dependencies.profileProtection.validateActiveProfile();
      if (
        validation.databaseHealth !== 'healthy' ||
        validation.migrationChainIdentity !== recovery.migrationPrefixIdentity
      ) {
        throw new DirectSetupBusinessRollbackError();
      }
      await this.dependencies.recoveryStore.write(
        transitionDirectSetupMigrationRecovery(recovery, {
          at: this.now(),
          state: 'awaitingPreviousBuild',
        }),
      );
      this.notifyCompleted(recovery.correlationId);
    } catch {
      await this.requireRecovery(recovery);
      this.notifyFailed(recovery.correlationId);
      this.notifyRecoveryRequired(recovery.correlationId);
      throw new DirectSetupBusinessRollbackError();
    }
  }

  async requireRecoveryAfterRestoreRollback(): Promise<never> {
    const recovery = await this.dependencies.recoveryStore.read();
    if (recovery?.state !== 'businessRollbackStarting') {
      throw new DirectSetupBusinessRollbackError();
    }
    this.assertRunningTarget(recovery);
    await this.requireRecovery(recovery);
    this.notifyFailed(recovery.correlationId);
    this.notifyRecoveryRequired(recovery.correlationId);
    throw new DirectSetupBusinessRollbackError();
  }

  private assertRunningTarget(
    recovery: Readonly<DirectSetupMigrationRecovery>,
  ): void {
    if (
      recovery.runningTargetBuildIdentity.appVersion !==
        this.dependencies.releaseInfo.appVersion ||
      recovery.runningTargetBuildIdentity.buildRevision !==
        this.dependencies.releaseInfo.buildRevision
    ) {
      throw new DirectSetupBusinessRollbackError();
    }
  }

  private async failSafe(
    recovery: Readonly<DirectSetupMigrationRecovery>,
  ): Promise<void> {
    if (
      recovery.state !== 'recoveryRequired' &&
      recovery.state !== 'businessRollbackStarting'
    ) {
      return;
    }
    await this.dependencies.recoveryStore.write(
      transitionDirectSetupMigrationRecovery(recovery, {
        at: this.now(),
        state: 'failedSafe',
      }),
    );
  }

  private async requireRecovery(
    recovery: Readonly<DirectSetupMigrationRecovery>,
  ): Promise<void> {
    if (recovery.state !== 'businessRollbackStarting') {
      return;
    }
    await this.dependencies.recoveryStore
      .write(
        transitionDirectSetupMigrationRecovery(recovery, {
          at: this.now(),
          state: 'recoveryRequired',
        }),
      )
      .catch(() => undefined);
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }

  private notifyStarted(correlationId: string): void {
    this.notify((observer) =>
      observer.operationStarted({ correlationId, stage: 'businessRollback' }),
    );
  }

  private notifyCompleted(correlationId: string): void {
    this.notify((observer) =>
      observer.operationCompleted({
        correlationId,
        durationMs: 0,
        stage: 'businessRollback',
      }),
    );
  }

  private notifyFailed(correlationId: string): void {
    this.notify((observer) =>
      observer.operationFailed({
        correlationId,
        durationMs: 0,
        errorCode: 'UPDATE_DIRECT_SETUP_BUSINESS_ROLLBACK_FAILED',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'businessRollback',
      }),
    );
  }

  private notifyRecoveryRequired(correlationId: string): void {
    this.notify((observer) =>
      observer.operationStateChanged?.({
        correlationId,
        stage: 'businessRollback',
        state: 'recoveryRequired',
      }),
    );
  }

  private notify(
    notification: (observer: UpdateOperationalObserver) => void,
  ): void {
    try {
      notification(
        this.dependencies.observer ?? noOpUpdateOperationalObserver,
      );
    } catch {
      // Diagnostics never controls direct Setup rollback.
    }
  }
}

function profileMatchesProtectedPrefix(
  inspection: Readonly<MigrationStartupInspection> | undefined,
  recovery: Readonly<DirectSetupMigrationRecovery>,
): boolean {
  return (
    inspection?.profileState === 'existing' &&
    inspection.appliedMigrationCount === recovery.appliedMigrationCount &&
    inspection.migrationChainIdentity === recovery.migrationPrefixIdentity
  );
}
