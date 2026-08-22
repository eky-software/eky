import type { RecoveryPointService } from '../../profileBackup/recoveryPoint/recoveryPointService.js';
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
  }): Promise<Readonly<StagedRecoveryPointRestore>> {
    if (
      !profileIdPattern.test(input.expectedMigrationChainIdentity) ||
      !profileIdPattern.test(input.expectedProfileId)
    ) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }

    try {
      const point = await this.service.createPreMigration();
      const staged = await this.store.stageForRestore({
        artifactId: point.artifactId,
        expectedMigrationChainIdentity:
          input.expectedMigrationChainIdentity,
        operationId: input.operationId,
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
      return Object.freeze({ ...staged });
    } catch {
      await this.staging
        .removeOperationRoot(input.operationId)
        .catch(() => undefined);
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }
  }

  removeStaging(
    operationId: WorkspaceBackupImportOperationId,
  ): Promise<void> {
    return this.staging.removeOperationRoot(operationId).catch(() => {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    });
  }
}
