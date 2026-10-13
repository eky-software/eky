import { OwnedProfileBackupInspectionError } from './inspectOwnedEncryptedProfileBackup.js';
import { ProfileBackupInspectionError } from './profileBackupInspectionTypes.js';
import type { OwnedProfileSnapshotValidator } from './profileSnapshotInspectionPort.js';
import type { ProfileBackupInspectionSummary } from './profileBackupInspectionTypes.js';
import { stageValidatedProfileBackup } from './stageValidatedProfileBackup.js';

export {
  ProfileBackupInspectionError,
  type ProfileBackupInspectionErrorCode,
  type ProfileBackupInspectionSummary,
} from './profileBackupInspectionTypes.js';

type ProfileSnapshotValidator = Pick<OwnedProfileSnapshotValidator,
  'validateProfileSnapshot' | 'removeProfileSnapshot'>;

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
  let firstFailure: unknown;
  let result: InspectedProfileBackup | undefined;
  try {
    const staged = await stageValidatedProfileBackup(input);
    result = {
      containerSha256: staged.containerSha256,
      summary: staged.summary,
    };
  } catch (error) {
    firstFailure = error;
  }
  try {
    await input.validator.removeProfileSnapshot(input.operationId);
  } catch (cleanupError) {
    const primary = firstFailure instanceof ProfileBackupInspectionError
      ? firstFailure : new ProfileBackupInspectionError('BACKUP_INSPECTION_UNAVAILABLE', {
          cause: firstFailure ?? cleanupError,
        });
    throw new OwnedProfileBackupInspectionError(primary, 'unverified');
  }
  if (firstFailure !== undefined) throw firstFailure;
  if (result === undefined) throw new ProfileBackupInspectionError('BACKUP_INSPECTION_UNAVAILABLE');
  return result;
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
