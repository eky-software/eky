import type { ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';

/** Policies differ by role; all authenticated business content must match. */
export function assertDeletionBackupCorrespondence(
  source: ProfileInspectionReceipt,
  exported: ProfileInspectionReceipt,
): void {
  if (
    source.migrationPolicy !== 'exactCurrentManifest' ||
    exported.migrationPolicy !== 'restoreCompatible' ||
    source.profileId !== exported.profileId ||
    source.migrationChainIdentity !== exported.migrationChainIdentity ||
    source.databaseHealth !== exported.databaseHealth ||
    source.artifactIdentity !== exported.artifactIdentity ||
    source.artifactCount !== exported.artifactCount ||
    source.artifactTotalByteSize !== exported.artifactTotalByteSize ||
    source.database.sha256 !== exported.database.sha256 ||
    source.database.byteSize !== exported.database.byteSize ||
    source.artifactCatalog.sha256 !== exported.artifactCatalog.sha256 ||
    source.artifactCatalog.byteSize !== exported.artifactCatalog.byteSize
  ) {
    throw new Error('PROFILE_BACKUP_CONTENT_MISMATCH');
  }
}
