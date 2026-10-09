import { promises as fileSystem } from 'node:fs';
import { materializeRecoveryPoint, type ProfileSnapshotValidator } from './materializeRecoveryPoint.js';
import type { RecoveryPointKeyProtector } from './recoveryPointKeyProtector.js';

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
    await fileSystem.rm(materialized.operationRoot, {
      force: true,
      recursive: true,
    });
  }
}
