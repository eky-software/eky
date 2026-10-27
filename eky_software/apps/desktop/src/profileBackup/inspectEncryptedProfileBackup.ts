import { OwnedProfileBackupInspectionError } from './inspectOwnedEncryptedProfileBackup.js';
import { ProfileBackupInspectionError } from './profileBackupInspectionTypes.js';
import type { OwnedProfileSnapshotValidator, ProfileSnapshotEvidencePort } from './profileSnapshotInspectionPort.js';
import type { ProfileBackupInspectionSummary } from './profileBackupInspectionTypes.js';
import { stageValidatedProfileBackup, type StagedValidatedProfileBackup } from './stageValidatedProfileBackup.js';
import type { ProfileInspectionReceipt, ProfileInspectionRequestIdentity } from '../runtime/profileInspectionMessages.js';
import type { AuthenticatedBackupFileIdentity } from './container/decryptBackupPayload.js';

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

export interface InspectedProfileBackupWithIdentity extends InspectedProfileBackup {
  readonly authenticatedFileIdentity: AuthenticatedBackupFileIdentity;
}

interface InspectionInput {
  containerPath: string;
  operationId: string;
  password: string;
  quarantineRoot: string;
  stagingRoot: string;
  validator: ProfileSnapshotValidator;
}

export async function inspectEncryptedProfileBackupWithIdentity(input: InspectionInput): Promise<InspectedProfileBackupWithIdentity> {
  return inspectAndCleanup(input, async staged => ({ containerSha256: staged.containerSha256,
    authenticatedFileIdentity: staged.authenticatedFileIdentity, summary: staged.summary }));
}

export interface InspectedDeletionBackupContent extends InspectedProfileBackupWithIdentity {
  readonly receipt: ProfileInspectionReceipt;
  readonly identity: ProfileInspectionRequestIdentity;
}

/** Main-only content evidence; it grants no deletion or activation authority. */
export async function inspectEncryptedProfileBackupContent(input: Omit<InspectionInput, 'validator'> & {
  validator: ProfileSnapshotValidator & ProfileSnapshotEvidencePort;
  onContentValidated?(content: InspectedDeletionBackupContent): void;
}): Promise<InspectedDeletionBackupContent> {
  if (typeof input.validator.withProfileSnapshotEvidence !== 'function') {
    throw new ProfileBackupInspectionError('BACKUP_INSPECTION_UNAVAILABLE');
  }
  return inspectAndCleanup(input, async staged => {
    const content = await input.validator.withProfileSnapshotEvidence(input.operationId,
      async ({ receipt, identity }, assertCurrent) => {
        await assertCurrent();
        return { containerSha256: staged.containerSha256, authenticatedFileIdentity: staged.authenticatedFileIdentity,
          summary: staged.summary, identity, receipt: Object.freeze({ ...receipt,
            database: Object.freeze({ ...receipt.database }), artifactCatalog: Object.freeze({ ...receipt.artifactCatalog }) }) };
      });
    // Retention is not cleanup success or a deletion-authority publication.
    input.onContentValidated?.(content);
    return content;
  });
}

async function inspectAndCleanup<T>(input: InspectionInput,
  project: (staged: StagedValidatedProfileBackup) => Promise<T>): Promise<T> {
  let firstFailure: unknown;
  let result: T | undefined;
  try {
    const staged = await stageValidatedProfileBackup(input);
    result = await project(staged);
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
