import { promises as fileSystem } from 'node:fs';
import type { ProfileSnapshotBrokerClient } from '../profileSnapshotBrokerClient.js';
import { materializeRecoveryPoint } from './materializeRecoveryPoint.js';
import type { RecoveryPointKeyProtector } from './recoveryPointKeyProtector.js';

interface ProfileSnapshotValidator {
  validateProfileSnapshot(operationId: string): ReturnType<
    ProfileSnapshotBrokerClient['validateProfileSnapshot']
  >;
}

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
