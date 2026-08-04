import { promises as fileSystem } from 'node:fs';

import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import type { ProfileBackupInspectionSummary } from './profileBackupInspectionTypes.js';
import { stageValidatedProfileBackup } from './stageValidatedProfileBackup.js';

export {
  ProfileBackupInspectionError,
  type ProfileBackupInspectionErrorCode,
  type ProfileBackupInspectionSummary,
} from './profileBackupInspectionTypes.js';

interface ProfileSnapshotValidator {
  validateProfileSnapshot(operationId: string): ReturnType<
    ProfileSnapshotBrokerClient['validateProfileSnapshot']
  >;
}

export interface InspectedProfileBackup {
  containerSha256: string;
  summary: ProfileBackupInspectionSummary;
}

export async function inspectEncryptedProfileBackupWithIdentity(input: {
  containerPath: string;
  operationId: string;
  password: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: ProfileSnapshotValidator;
}): Promise<InspectedProfileBackup> {
  const staged = await stageValidatedProfileBackup(input);

  try {
    return {
      containerSha256: staged.containerSha256,
      summary: staged.summary,
    };
  } finally {
    await fileSystem.rm(staged.operationRoot, {
      force: true,
      recursive: true,
    });
  }
}

export async function inspectEncryptedProfileBackup(input: {
  containerPath: string;
  operationId: string;
  password: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: ProfileSnapshotValidator;
}): Promise<ProfileBackupInspectionSummary> {
  return (
    await inspectEncryptedProfileBackupWithIdentity(input)
  ).summary;
}
