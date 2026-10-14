import type { RecoveryPointStore } from '../recoveryPoint/recoveryPointStore.js';
import { RecoveryPointCleanupError } from '../recoveryPoint/recoveryPointOperationError.js';
import type { ProfileSnapshotOwnershipPort } from '../profileSnapshotInspectionPort.js';
import type { PreparedProfileRestore } from './profileRestoreStagingService.js';
import {
  PreparedProfileRestoreOwner,
  type PreparedProfileRestoreClaim,
} from './preparedProfileRestoreOwner.js';

const artifactIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;

interface RecoveryPointRestoreStagingServiceDependencies {
  profileSnapshotClient: Pick<ProfileSnapshotOwnershipPort,
    'withInspectionOperation' | 'withProfileSnapshot' | 'removeProfileSnapshot'>;
  store: Pick<RecoveryPointStore, 'stageForRestore'>;
}

export class RecoveryPointRestoreStagingService {
  private busy = false;
  private cleanupUnverified = false;
  private readonly preparedOwner = new PreparedProfileRestoreOwner();

  constructor(
    private readonly dependencies: RecoveryPointRestoreStagingServiceDependencies,
  ) {}

  async stage(input: {
    artifactId: string;
    expectedMigrationChainIdentity: string;
    operationId: string;
  }): Promise<PreparedProfileRestore> {
    if (
      this.busy || this.cleanupUnverified ||
      !artifactIdPattern.test(input.artifactId) ||
      !sha256Pattern.test(input.expectedMigrationChainIdentity) ||
      !artifactIdPattern.test(input.operationId)
    ) {
      throw new Error('UPDATE_RECOVERY_POINT_STAGING_FAILED');
    }
    try {
      this.preparedOwner.assertCanStage();
    } catch (error) {
      throw new Error('UPDATE_RECOVERY_POINT_STAGING_FAILED', { cause: error });
    }
    this.busy = true;

    try {
      return await this.dependencies.profileSnapshotClient.withInspectionOperation(async () => {
        let staged = false;
        try {
          const materialized = await this.dependencies.store.stageForRestore({
            artifactId: input.artifactId,
            expectedMigrationChainIdentity: input.expectedMigrationChainIdentity,
            operationId: input.operationId,
          });
          staged = true;
          const prepared = await this.dependencies.profileSnapshotClient.withProfileSnapshot(input.operationId, async () => {
            const result: PreparedProfileRestore = {
              operationId: input.operationId,
              summary: {
                appVersion: materialized.appVersion,
                compatibilityStatus: 'compatible',
                createdAt: materialized.createdAt,
                databaseHealth: 'healthy',
                documentCount: materialized.documentCount,
                formatVersion: 1,
                profileMatchStatus: 'same',
                totalBusinessByteSize: materialized.artifactTotalByteSize,
              },
              targetDisposition: 'replaceActiveProfile',
            };
            return result;
          });
          return this.preparedOwner.set(prepared);
        } catch (error) {
          if (staged) {
            try {
              await this.dependencies.profileSnapshotClient.removeProfileSnapshot(input.operationId);
            } catch {
              throw new RecoveryPointCleanupError(error);
            }
          }
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof RecoveryPointCleanupError) this.cleanupUnverified = true;
      throw new Error('UPDATE_RECOVERY_POINT_STAGING_FAILED', { cause: error });
    } finally {
      this.busy = false;
    }
  }

  getPreparedRestore(
    operationId: string,
  ): PreparedProfileRestore | undefined {
    return this.preparedOwner.get(operationId);
  }

  claimPreparedRestore(
    operationId: string,
  ): PreparedProfileRestoreClaim | undefined {
    if (this.busy || this.cleanupUnverified) throw new Error('PROFILE_RESTORE_BUSY');
    return this.preparedOwner.claim(operationId);
  }
}
