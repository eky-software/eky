import { materializeRecoveryPoint, type ProfileSnapshotValidator } from './materializeRecoveryPoint.js';
import type { RecoveryPointKeyProtector } from './recoveryPointKeyProtector.js';
import { RecoveryPointCleanupError } from './recoveryPointOperationError.js';

export interface RecoveryPointInspection {
  appVersion: string;
  createdAt: string;
  documentCount: number;
  migrationChainIdentity: string;
  profileId: string;
}

export async function inspectRecoveryPoint(input: {
  artifactId: string;
  containerPath: string;
  expectedProfileId: string;
  keyEnvelopePath: string;
  keyProtector: RecoveryPointKeyProtector;
  operationId: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: ProfileSnapshotValidator;
  updateMaintenanceOperationId?: string;
}): Promise<RecoveryPointInspection> {
  const materialized = await materializeRecoveryPoint(input);
  try {
    return {
      appVersion: materialized.appVersion,
      createdAt: materialized.createdAt,
      documentCount: materialized.documentCount,
      migrationChainIdentity: materialized.migrationChainIdentity,
      profileId: materialized.profileId,
    };
  } finally {
    try { await input.validator.removeProfileSnapshot(input.operationId); }
    catch (error) { throw new RecoveryPointCleanupError(error); }
  }
}
