import type { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import type { RecoveryPointService } from '../profileBackup/recoveryPoint/recoveryPointService.js';
import type { DirectSetupMigrationRecoveryStore } from './directSetupMigrationRecoveryStore.js';
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
  restoreRecoveryPoint(input: {
    expectedMigrationChainIdentity: string;
    operationId: string;
    recoveryPointReference: string;
  }): Promise<'relaunching'>;
  validateActiveProfile(): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
    migrationChainIdentity: string;
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
  restoreRecoveryPoint?(input: {
    expectedMigrationChainIdentity: string;
    operationId: string;
    recoveryPointReference: string;
  }): Promise<'relaunching'>;
  directSetupRecoveryStore: Pick<DirectSetupMigrationRecoveryStore, 'read'>;
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
          dependencies.directSetupRecoveryStore,
        );
      if (protectedReferences.includes(recoveryPointReference)) {
        throw new Error('UPDATE_RECOVERY_POINT_STILL_PROTECTED');
      }
    },
    async restoreRecoveryPoint(input: {
      expectedMigrationChainIdentity: string;
      operationId: string;
      recoveryPointReference: string;
    }) {
      assertRecoveryPointReference(input.recoveryPointReference);
      assertRestoreIdentity(input);
      if (dependencies.restoreRecoveryPoint === undefined) {
        throw new Error('UPDATE_ROLLBACK_NOT_IMPLEMENTED');
      }
      return dependencies.restoreRecoveryPoint(input);
    },
    async validateActiveProfile() {
      const validation =
        await dependencies.profileSnapshotClient.validateActiveProfile();
      return Object.freeze({
        artifactCount: validation.artifactCount,
        artifactTotalByteSize: validation.artifactTotalByteSize,
        databaseHealth: validation.databaseHealth,
        migrationChainIdentity: validation.migrationChainIdentity,
      });
    },
  });
}

function assertRestoreIdentity(input: {
  expectedMigrationChainIdentity: string;
  operationId: string;
}): void {
  if (
    !/^[a-f0-9]{64}$/.test(input.expectedMigrationChainIdentity) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.operationId,
    )
  ) {
    throw new Error('UPDATE_RECOVERY_POINT_INVALID');
  }
}

function assertRecoveryPointReference(reference: string): void {
  if (!recoveryPointReferencePattern.test(reference)) {
    throw new Error('UPDATE_RECOVERY_POINT_INVALID');
  }
}
