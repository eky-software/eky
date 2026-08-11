import type { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import type { RecoveryPointService } from '../profileBackup/recoveryPoint/recoveryPointService.js';
import type { UpdateJournalStore } from './updateJournalStore.js';
import { readUpdateProtectedRecoveryPointReferences } from './updateRecoveryPointProtection.js';

const recoveryPointReferencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface UpdateProfileProtection {
  createValidatedPreMigrationPoint(): Promise<string>;
  createValidatedPreUpdatePoint(): Promise<string>;
  enterMaintenance(operationId: string): Promise<void>;
  leaveMaintenance(operationId: string): Promise<void>;
  releaseProtectedPoint(recoveryPointReference: string): Promise<void>;
  restoreRecoveryPoint(recoveryPointReference: string): Promise<void>;
  validateActiveProfile(): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
  }>;
}

interface ProfileProtectionCompositionDependencies {
  profileSnapshotClient: Pick<
    ProfileSnapshotBrokerClient,
    'beginMaintenance' | 'endMaintenance' | 'validateActiveProfile'
  >;
  recoveryPointService: Pick<
    RecoveryPointService,
    'createPreMigration' | 'createPreUpdate'
  >;
  restoreRecoveryPoint?(reference: string): Promise<void>;
  updateJournalStore: Pick<UpdateJournalStore, 'read'>;
}

export function createProfileProtectionComposition(
  dependencies: ProfileProtectionCompositionDependencies,
): UpdateProfileProtection {
  return Object.freeze({
    async createValidatedPreMigrationPoint() {
      return (await dependencies.recoveryPointService.createPreMigration())
        .artifactId;
    },
    async createValidatedPreUpdatePoint() {
      return (await dependencies.recoveryPointService.createPreUpdate())
        .artifactId;
    },
    async enterMaintenance(operationId: string) {
      await dependencies.profileSnapshotClient.beginMaintenance(operationId);
    },
    async leaveMaintenance(operationId: string) {
      await dependencies.profileSnapshotClient.endMaintenance(operationId);
    },
    async releaseProtectedPoint(recoveryPointReference: string) {
      assertRecoveryPointReference(recoveryPointReference);
      const protectedReferences =
        await readUpdateProtectedRecoveryPointReferences(
          dependencies.updateJournalStore,
        );
      if (protectedReferences.includes(recoveryPointReference)) {
        throw new Error('UPDATE_RECOVERY_POINT_STILL_PROTECTED');
      }
    },
    async restoreRecoveryPoint(recoveryPointReference: string) {
      assertRecoveryPointReference(recoveryPointReference);
      if (dependencies.restoreRecoveryPoint === undefined) {
        throw new Error('UPDATE_ROLLBACK_NOT_IMPLEMENTED');
      }
      await dependencies.restoreRecoveryPoint(recoveryPointReference);
    },
    async validateActiveProfile() {
      const validation =
        await dependencies.profileSnapshotClient.validateActiveProfile();
      return Object.freeze({
        artifactCount: validation.artifactCount,
        artifactTotalByteSize: validation.artifactTotalByteSize,
        databaseHealth: validation.databaseHealth,
      });
    },
  });
}

function assertRecoveryPointReference(reference: string): void {
  if (!recoveryPointReferencePattern.test(reference)) {
    throw new Error('UPDATE_RECOVERY_POINT_INVALID');
  }
}
