import { encodeProfileInspectionDocumentBindings, type ProfileInspectionDocumentBinding } from '../../runtime/profileInspectionDocumentBindings.js';
import type { ColdProfileInspectionReceipt } from '../../runtime/profileInspectionMessages.js';

interface Content {
  readonly receipt: Omit<ColdProfileInspectionReceipt, 'databaseSlot' | 'documentsSlot'>;
  readonly documents: readonly ProfileInspectionDocumentBinding[];
}

/** Slot moves may change location, never the first attested content. */
export function assertProfileRestoreContentMatches(first: Content, next: Content): void {
  const a = first.receipt;
  const b = next.receipt;
  if (a.profileId !== b.profileId || a.migrationChainIdentity !== b.migrationChainIdentity ||
      a.migrationPolicy !== b.migrationPolicy || a.databaseHealth !== b.databaseHealth ||
      a.database.byteSize !== b.database.byteSize || a.database.sha256 !== b.database.sha256 ||
      a.artifactCount !== b.artifactCount || a.artifactTotalByteSize !== b.artifactTotalByteSize ||
      a.artifactIdentity !== b.artifactIdentity || a.documentBindings.byteSize !== b.documentBindings.byteSize ||
      a.documentBindings.sha256 !== b.documentBindings.sha256 ||
      !encodeProfileInspectionDocumentBindings(first.documents).equals(encodeProfileInspectionDocumentBindings(next.documents))) {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
}
