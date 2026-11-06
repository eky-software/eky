import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { CrashSafeFileSlot } from '../persistence/crashSafeFileSlot.js';
import { deletionDataRecord, deletionDigest, invalidDeletionData, parseDeletionJson } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryCommitment, captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';

export const maximumWorkspaceDeletionJournalBytes = 16 * 1_024;
export const workspaceDeletionPhases = Object.freeze([
  'authorized', 'quarantined', 'purgeAuthorized', 'purged', 'registryPublished',
] as const);
const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';
export const maximumWorkspaceDeletionOriginalJournalProofs = 3;
export const workspaceDeletionOriginalJournalOwners = Object.freeze([
  'workspaceImport', 'workspaceLegacyAdoption', 'workspaceReplacement', 'workspaceActivationMigration',
] as const);

function captureWorkspaceDeletionJournalV1(value: unknown) {
  try {
    deletionDataRecord(value, ['formatVersion', 'target', 'phase', 'registryBeforeSha256', 'registryAfterSha256',
      'previousActiveWorkspaceId', 'backupDisposition', 'inventory', 'inventoryFileIdentity',
      'operationRootIdentity', 'operationParentIdentity'], invalidCode);
    if (value.formatVersion !== 1 || !workspaceDeletionPhases.some(phase => phase === value.phase) ||
        (value.backupDisposition !== 'verifiedBackup' && value.backupDisposition !== 'explicitDataLoss')) {
      return invalidDeletionData(invalidCode);
    }
    const registryBeforeSha256 = deletionDigest(value.registryBeforeSha256, invalidCode);
    const registryAfterSha256 = deletionDigest(value.registryAfterSha256, invalidCode);
    if (registryBeforeSha256 === registryAfterSha256) return invalidDeletionData(invalidCode);
    return Object.freeze({
      formatVersion: 1 as const, target: captureDeletionInventoryHeader(value.target),
      phase: value.phase as (typeof workspaceDeletionPhases)[number], registryBeforeSha256, registryAfterSha256,
      previousActiveWorkspaceId: value.previousActiveWorkspaceId === null ? null : validateWorkspaceId(value.previousActiveWorkspaceId),
      backupDisposition: value.backupDisposition,
      inventory: captureDeletionInventoryCommitment(value.inventory),
      inventoryFileIdentity: deletionDigest(value.inventoryFileIdentity, invalidCode),
      operationRootIdentity: deletionDigest(value.operationRootIdentity, invalidCode),
      operationParentIdentity: deletionDigest(value.operationParentIdentity, invalidCode),
    });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceDeletionJournalV1 = ReturnType<typeof captureWorkspaceDeletionJournalV1>;

function captureOriginalJournalIdentity(value: unknown) {
  deletionDataRecord(value, ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'], invalidCode);
  if (![value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].every(field =>
    typeof field === 'number' && Number.isFinite(field)) || value.ino === 0 || (value.size as number) < 1) {
    return invalidDeletionData(invalidCode);
  }
  return Object.freeze({ dev: value.dev as number, ino: value.ino as number, size: value.size as number,
    mtimeMs: value.mtimeMs as number, ctimeMs: value.ctimeMs as number });
}

// This validates the durable commitment, not the current original-owner slot selection.
export function captureWorkspaceDeletionOriginalJournalProof(targetValue: unknown, value: unknown) {
  try {
    const target = captureDeletionInventoryHeader(targetValue);
    deletionDataRecord(value, ['owner', 'operationId', 'bindingSha256', 'slots'], invalidCode);
    if (!workspaceDeletionOriginalJournalOwners.includes(value.owner as typeof workspaceDeletionOriginalJournalOwners[number])) {
      return invalidDeletionData(invalidCode);
    }
    const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: value.owner, operationId: value.operationId,
      workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
    const bindingSha256 = deletionDigest(value.bindingSha256, invalidCode);
    if (bindingSha256 !== workspaceRemnantBindingSha256(binding)) return invalidDeletionData(invalidCode);
    deletionDataRecord(value.slots, ['current', 'next', 'backup'], invalidCode);
    const slots = {} as Record<CrashSafeFileSlot, null | Readonly<{ sha256: string; identity: ReturnType<typeof captureOriginalJournalIdentity> }>>;
    let count = 0;
    for (const slot of ['current', 'next', 'backup'] as const) {
      const selected = value.slots[slot];
      if (selected === null) { slots[slot] = null; continue; }
      deletionDataRecord(selected, ['sha256', 'identity'], invalidCode);
      slots[slot] = Object.freeze({ sha256: deletionDigest(selected.sha256, invalidCode),
        identity: captureOriginalJournalIdentity(selected.identity) });
      count++;
    }
    if (count < 1 || count > 2) return invalidDeletionData(invalidCode);
    return Object.freeze({ owner: binding.owner as typeof workspaceDeletionOriginalJournalOwners[number],
      operationId: binding.operationId, bindingSha256, slots: Object.freeze(slots) });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceDeletionOriginalJournalProof = ReturnType<typeof captureWorkspaceDeletionOriginalJournalProof>;

function originalJournalOwnerRank(owner: WorkspaceDeletionOriginalJournalProof['owner']) {
  return owner === 'workspaceImport' ? 0 : owner === 'workspaceLegacyAdoption' ? 1 : 2;
}

export function captureWorkspaceDeletionJournal(value: unknown) {
  try {
    if (value === null || typeof value !== 'object' || Object.getOwnPropertyDescriptor(value, 'formatVersion')?.value !== 2) {
      return captureWorkspaceDeletionJournalV1(value);
    }
    deletionDataRecord(value, ['formatVersion', 'target', 'phase', 'registryBeforeSha256', 'registryAfterSha256',
      'previousActiveWorkspaceId', 'backupDisposition', 'inventory', 'inventoryFileIdentity',
      'operationRootIdentity', 'operationParentIdentity', 'originalJournalProofs'], invalidCode);
    const { originalJournalProofs, ...rest } = value;
    const journal = captureWorkspaceDeletionJournalV1({ ...rest, formatVersion: 1 });
    if (!Array.isArray(originalJournalProofs) || Object.getPrototypeOf(originalJournalProofs) !== Array.prototype) {
      return invalidDeletionData(invalidCode);
    }
    const length: unknown = Object.getOwnPropertyDescriptor(originalJournalProofs, 'length')?.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 ||
        length > maximumWorkspaceDeletionOriginalJournalProofs || Reflect.ownKeys(originalJournalProofs).length !== length + 1) {
      return invalidDeletionData(invalidCode);
    }
    const proofs: WorkspaceDeletionOriginalJournalProof[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(originalJournalProofs, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return invalidDeletionData(invalidCode);
      const proof = captureWorkspaceDeletionOriginalJournalProof(journal.target, descriptor.value);
      const previous = proofs.at(-1);
      if (previous !== undefined && originalJournalOwnerRank(proof.owner) <= originalJournalOwnerRank(previous.owner)) {
        return invalidDeletionData(invalidCode);
      }
      proofs.push(proof);
    }
    return Object.freeze({ ...journal, formatVersion: 2 as const, originalJournalProofs: Object.freeze(proofs) });
  } catch { return invalidDeletionData(invalidCode); }
}
export type WorkspaceDeletionJournal = ReturnType<typeof captureWorkspaceDeletionJournal>;
export type WorkspaceDeletionJournalV2 = Extract<WorkspaceDeletionJournal, { formatVersion: 2 }>;

export function serializeWorkspaceDeletionJournal(value: WorkspaceDeletionJournal): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(captureWorkspaceDeletionJournal(value))}\n`);
  if (bytes.byteLength > maximumWorkspaceDeletionJournalBytes) return invalidDeletionData(invalidCode);
  return bytes;
}

export function parseWorkspaceDeletionJournalBytes(bytes: Uint8Array): WorkspaceDeletionJournal {
  return captureWorkspaceDeletionJournal(parseDeletionJson(bytes, maximumWorkspaceDeletionJournalBytes, invalidCode));
}

export function sameWorkspaceDeletionJournalBinding(left: WorkspaceDeletionJournal, right: WorkspaceDeletionJournal): boolean {
  const { phase: _left, ...before } = captureWorkspaceDeletionJournal(left);
  const { phase: _right, ...after } = captureWorkspaceDeletionJournal(right);
  return JSON.stringify(before) === JSON.stringify(after);
}
