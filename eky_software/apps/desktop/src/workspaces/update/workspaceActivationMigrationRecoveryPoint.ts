import { isRecoveryPointCleanupUnverified, type RecoveryPointService } from '../../profileBackup/recoveryPoint/recoveryPointService.js';
import { captureProfileSnapshotCleanupAuthority, type ProfileSnapshotCleanupAuthority } from '../../profileBackup/profileSnapshotInspectionPort.js';
import type {
  RecoveryPointStore,
  StagedRecoveryPointRestore,
} from '../../profileBackup/recoveryPoint/recoveryPointStore.js';
import type { WorkspaceBackupImportOperationId } from '../import/workspaceBackupImportTypes.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';

const profileIdPattern = /^[a-f0-9]{64}$/;

export interface WorkspaceActivationMigrationStagingPort {
  assertOperationRoot(input: {
    readonly operationId: WorkspaceBackupImportOperationId;
    readonly operationRoot: string;
  }): Promise<void>;
  removeOperationRoot(
    operationId: WorkspaceBackupImportOperationId,
    cleanupAuthority?: ProfileSnapshotCleanupAuthority,
  ): Promise<void>;
}

export class WorkspaceActivationMigrationRecoveryPoint {
  constructor(
    private readonly service: Pick<RecoveryPointService, 'createPreMigration'>,
    private readonly store: Pick<RecoveryPointStore, 'stageForRestore'>,
    private readonly staging: WorkspaceActivationMigrationStagingPort,
  ) {}

  async createAndStage(input: {
    readonly expectedMigrationChainIdentity: string;
    readonly expectedProfileId: string;
    readonly operationId: WorkspaceBackupImportOperationId;
    readonly cleanupAuthority?: ProfileSnapshotCleanupAuthority;
  }): Promise<Readonly<StagedRecoveryPointRestore>> {
    const cleanupAuthority = captureProfileSnapshotCleanupAuthority(input.cleanupAuthority);
    if (
      !profileIdPattern.test(input.expectedMigrationChainIdentity) ||
      !profileIdPattern.test(input.expectedProfileId)
    ) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }

    try {
      if (cleanupAuthority !== undefined) {
        await cleanupAuthority.assertOwned();
        cleanupAuthority.assertCurrent();
      }
      const point = cleanupAuthority === undefined
        ? await this.service.createPreMigration()
        : await this.service.createPreMigration(cleanupAuthority);
      if (cleanupAuthority !== undefined) {
        await cleanupAuthority.assertOwned();
        cleanupAuthority.assertCurrent();
      }
      const staged = await this.store.stageForRestore({
        artifactId: point.artifactId,
        expectedMigrationChainIdentity:
          input.expectedMigrationChainIdentity,
        operationId: input.operationId,
        ...(cleanupAuthority === undefined ? {} : { cleanupAuthority }),
      });
      await this.staging.assertOperationRoot({
        operationId: input.operationId,
        operationRoot: staged.operationRoot,
      });
      if (
        staged.profileId !== input.expectedProfileId ||
        staged.migrationChainIdentity !==
          input.expectedMigrationChainIdentity
      ) {
        throw new Error('identity-mismatch');
      }
      if (cleanupAuthority !== undefined) {
        await cleanupAuthority.assertOwned();
        cleanupAuthority.assertCurrent();
      }
      return Object.freeze({ ...staged });
    } catch (primary) {
      let cause = primary;
      if (!isRecoveryPointCleanupUnverified(primary)) {
        try {
          if (cleanupAuthority === undefined) await this.staging.removeOperationRoot(input.operationId);
          else await this.staging.removeOperationRoot(input.operationId, cleanupAuthority);
        } catch (cleanup) {
          cause = new AggregateError([primary, cleanup], 'WORKSPACE_ACTIVATION_MIGRATION_FAILED');
        }
      }
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED', { cause },
      );
    }
  }

  removeStaging(
    operationId: WorkspaceBackupImportOperationId,
    cleanupAuthority?: ProfileSnapshotCleanupAuthority,
  ): Promise<void> {
    const authority = captureProfileSnapshotCleanupAuthority(cleanupAuthority);
    return (authority === undefined ? this.staging.removeOperationRoot(operationId)
      : this.staging.removeOperationRoot(operationId, authority)).catch((cause: unknown) => {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED', { cause },
      );
    });
  }
}
