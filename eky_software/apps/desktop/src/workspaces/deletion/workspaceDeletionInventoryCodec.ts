import { isProfileInspectionOperationId } from '../../runtime/profileInspectionMessages.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deletionDataRecord, deletionDigest, invalidDeletionData } from './workspaceDeletionDataValidation.js';

export const maximumDeletionInventoryLineBytes = 2_048;
export const deletionInventoryReadChunkBytes = 4_096;
export const deletionInventoryFormatVersion = 2;
const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';
const roles = ['workspace', 'legacyEntry', 'replacementImport', 'activationStaging',
  'activationRollback', 'activationFailed', 'importCandidate', 'adoptionCandidate', 'inspection', 'inspectionEvidence'] as const;

export function captureDeletionInventoryHeader(value: unknown) {
  try {
    deletionDataRecord(value, ['formatVersion', 'operationId', 'workspaceId', 'lineageIdentity', 'registryEntrySha256'], invalidCode);
    if (value.formatVersion !== deletionInventoryFormatVersion) return invalidDeletionData(invalidCode);
    return Object.freeze({
      formatVersion: deletionInventoryFormatVersion,
      operationId: validateWorkspaceBackupReplacementOperationId(value.operationId),
      workspaceId: validateWorkspaceId(value.workspaceId),
      lineageIdentity: validateWorkspaceLineage(value.lineageIdentity),
      registryEntrySha256: deletionDigest(value.registryEntrySha256, invalidCode),
    });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceDeletionInventoryHeader = ReturnType<typeof captureDeletionInventoryHeader>;

export function captureDeletionInventoryRecord(value: unknown) {
  try {
    deletionDataRecord(value, ['role', 'ownerOperationId', 'generationId', 'member',
      'rootIdentity', 'parentIdentity', 'bindingSha256'], invalidCode);
    if (!roles.some(role => role === value.role)) return invalidDeletionData(invalidCode);
    const role = value.role as (typeof roles)[number];
    let ownerOperationId: string | null = null;
    let generationId: string | null = null;
    let member: string | null = null;
    if (role === 'workspace' || role === 'legacyEntry') {
      if (value.ownerOperationId !== null || value.generationId !== null) return invalidDeletionData(invalidCode);
    } else if (role === 'inspection' || role === 'inspectionEvidence') {
      if (!isProfileInspectionOperationId(value.ownerOperationId) || !isProfileInspectionOperationId(value.generationId)) {
        return invalidDeletionData(invalidCode);
      }
      ownerOperationId = value.ownerOperationId;
      generationId = value.generationId;
    } else {
      ownerOperationId = validateWorkspaceBackupReplacementOperationId(value.ownerOperationId);
      if (value.generationId !== null) return invalidDeletionData(invalidCode);
    }
    if (role === 'legacyEntry') {
      if (typeof value.member !== 'string' || !workspaceOwnedEntryNames.includes(value.member)) {
        return invalidDeletionData(invalidCode);
      }
      member = value.member;
    } else if (value.member !== null) return invalidDeletionData(invalidCode);
    if (role === 'workspace' ? value.bindingSha256 !== null : value.bindingSha256 === null) {
      return invalidDeletionData(invalidCode);
    }
    return Object.freeze({
      role, ownerOperationId, generationId, member,
      rootIdentity: deletionDigest(value.rootIdentity, invalidCode),
      parentIdentity: deletionDigest(value.parentIdentity, invalidCode),
      bindingSha256: value.bindingSha256 === null ? null : deletionDigest(value.bindingSha256, invalidCode),
    });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceDeletionInventoryRecord = ReturnType<typeof captureDeletionInventoryRecord>;

// Metadata evidence never becomes an independent physical deletion target.
export function captureDeletionInventoryPayloadRecord(value: unknown) {
  const record = captureDeletionInventoryRecord(value);
  if (record.role === 'inspectionEvidence') return invalidDeletionData(invalidCode);
  return Object.freeze({ ...record, role: record.role });
}
export type WorkspaceDeletionInventoryPayloadRecord = ReturnType<typeof captureDeletionInventoryPayloadRecord>;

export function deletionInventoryRecordKey(value: WorkspaceDeletionInventoryRecord): string {
  return [value.role, value.ownerOperationId ?? '', value.generationId ?? '', value.member ?? ''].join('/');
}

export function captureDeletionInventoryCommitment(value: unknown) {
  deletionDataRecord(value, ['formatVersion', 'byteLength', 'recordCount', 'sha256'], invalidCode);
  if (value.formatVersion !== deletionInventoryFormatVersion || typeof value.byteLength !== 'number' ||
      !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 ||
      typeof value.recordCount !== 'number' || !Number.isSafeInteger(value.recordCount) || value.recordCount < 0) {
    return invalidDeletionData(invalidCode);
  }
  return Object.freeze({ formatVersion: deletionInventoryFormatVersion, byteLength: value.byteLength,
    recordCount: value.recordCount, sha256: deletionDigest(value.sha256, invalidCode) });
}
export type WorkspaceDeletionInventoryCommitment = ReturnType<typeof captureDeletionInventoryCommitment>;

export function deletionInventoryLine(value: WorkspaceDeletionInventoryHeader | WorkspaceDeletionInventoryRecord): Buffer {
  const captured = 'role' in value ? captureDeletionInventoryRecord(value) : captureDeletionInventoryHeader(value);
  const bytes = Buffer.from(`${JSON.stringify(captured)}\n`);
  if (bytes.byteLength > maximumDeletionInventoryLineBytes) return invalidDeletionData(invalidCode);
  return bytes;
}
