import { createHash } from 'node:crypto';
import { isProfileInspectionOperationId } from '../../runtime/profileInspectionMessages.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { isPlainDataRecord } from '../registry/workspaceRegistryValueShape.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deletionDataRecord, deletionDigest, invalidDeletionData, parseDeletionJson } from './workspaceDeletionDataValidation.js';

export const maximumWorkspaceRemnantBindingBytes = 4_096;
export const workspaceRemnantBindingInvalidCode = 'WORKSPACE_REMNANT_BINDING_INVALID';
const invalidCode = workspaceRemnantBindingInvalidCode;
const owners = ['workspaceReplacement', 'workspaceActivationMigration', 'workspaceImport',
  'workspaceLegacyAdoption', 'profileInspection'] as const;
const baseKeys = ['formatVersion', 'owner', 'operationId', 'workspaceId', 'lineageIdentity'];

export function captureWorkspaceRemnantBinding(value: unknown) {
  try {
    if (!isPlainDataRecord(value)) return invalidDeletionData(invalidCode);
    const ownerValue: unknown = Object.getOwnPropertyDescriptor(value, 'owner')?.value;
    if (!owners.some(owner => owner === ownerValue)) return invalidDeletionData(invalidCode);
    const owner = ownerValue as (typeof owners)[number];
    deletionDataRecord(value, owner === 'profileInspection'
      ? [...baseKeys, 'generationId', 'rootIdentity', 'parentIdentity'] : baseKeys, invalidCode);
    if (value.formatVersion !== 1) return invalidDeletionData(invalidCode);
    const operationId = owner === 'profileInspection'
      ? inspectionId(value.operationId) : validateWorkspaceBackupReplacementOperationId(value.operationId);
    const base = { formatVersion: 1 as const, operationId, workspaceId: validateWorkspaceId(value.workspaceId),
      lineageIdentity: validateWorkspaceLineage(value.lineageIdentity) };
    if (owner === 'profileInspection') return Object.freeze({ formatVersion: base.formatVersion, owner,
      operationId: base.operationId, workspaceId: base.workspaceId, lineageIdentity: base.lineageIdentity,
      generationId: inspectionId(value.generationId), rootIdentity: deletionDigest(value.rootIdentity, invalidCode),
      parentIdentity: deletionDigest(value.parentIdentity, invalidCode) });
    return Object.freeze({ formatVersion: base.formatVersion, owner, operationId: base.operationId,
      workspaceId: base.workspaceId, lineageIdentity: base.lineageIdentity });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceRemnantBindingV1 = ReturnType<typeof captureWorkspaceRemnantBinding>;

export function serializeWorkspaceRemnantBinding(value: WorkspaceRemnantBindingV1): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(captureWorkspaceRemnantBinding(value))}\n`);
  if (bytes.byteLength > maximumWorkspaceRemnantBindingBytes) return invalidDeletionData(invalidCode);
  return bytes;
}

export function parseWorkspaceRemnantBinding(bytes: Uint8Array): WorkspaceRemnantBindingV1 {
  if (!(bytes instanceof Uint8Array) || bytes.at(-1) !== 10) return invalidDeletionData(invalidCode);
  return captureWorkspaceRemnantBinding(parseDeletionJson(bytes, maximumWorkspaceRemnantBindingBytes, invalidCode));
}

export function workspaceRemnantBindingSha256(value: WorkspaceRemnantBindingV1): string {
  return createHash('sha256').update(serializeWorkspaceRemnantBinding(value)).digest('hex');
}

export function captureWorkspaceRemnantBindingKey(value: unknown) {
  try {
    if (!isPlainDataRecord(value)) return invalidDeletionData(invalidCode);
    const ownerValue: unknown = Object.getOwnPropertyDescriptor(value, 'owner')?.value;
    if (!owners.some(owner => owner === ownerValue)) return invalidDeletionData(invalidCode);
    const owner = ownerValue as (typeof owners)[number];
    if (owner === 'workspaceLegacyAdoption') {
      deletionDataRecord(value, ['owner', 'workspaceId'], invalidCode);
      return Object.freeze({ owner, workspaceId: validateWorkspaceId(value.workspaceId) });
    }
    if (owner === 'profileInspection') {
      deletionDataRecord(value, ['owner', 'operationId', 'generationId'], invalidCode);
      return Object.freeze({ owner, operationId: inspectionId(value.operationId), generationId: inspectionId(value.generationId) });
    }
    deletionDataRecord(value, ['owner', 'operationId'], invalidCode);
    return Object.freeze({ owner, operationId: validateWorkspaceBackupReplacementOperationId(value.operationId) });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceRemnantBindingKey = ReturnType<typeof captureWorkspaceRemnantBindingKey>;

export function workspaceRemnantBindingKey(value: WorkspaceRemnantBindingV1): WorkspaceRemnantBindingKey {
  const captured = captureWorkspaceRemnantBinding(value);
  if (captured.owner === 'workspaceLegacyAdoption') return captureWorkspaceRemnantBindingKey({ owner: captured.owner, workspaceId: captured.workspaceId });
  if (captured.owner === 'profileInspection') return captureWorkspaceRemnantBindingKey({ owner: captured.owner,
    operationId: captured.operationId, generationId: captured.generationId });
  return captureWorkspaceRemnantBindingKey({ owner: captured.owner, operationId: captured.operationId });
}

function inspectionId(value: unknown): string {
  if (!isProfileInspectionOperationId(value)) return invalidDeletionData(invalidCode);
  return value;
}
