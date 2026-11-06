import { createHash } from 'node:crypto';
import type { WorkspaceDeletionPublicationContext } from '../management/workspaceDeletionPreparation.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader, deletionInventoryFormatVersion } from './workspaceDeletionInventoryCodec.js';

// Observation only: the caller must still prove fresh slots, ownership and payload absence at publication.
export function captureWorkspaceDeletionRegistryTransition(
  slots: ReadOnlyJournalSlots<LocalWorkspaceRegistry>, context: Readonly<WorkspaceDeletionPublicationContext>,
) {
  if (slots.current === undefined || slots.current.identity === undefined ||
      slots.next !== undefined || slots.backup !== undefined) {
    return invalidDeletionData('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  }
  const beforeBytes = Uint8Array.from(slots.current.bytes);
  const before = parseWorkspaceRegistryBytes(beforeBytes);
  const target = context.target;
  const header = captureDeletionInventoryHeader({ formatVersion: deletionInventoryFormatVersion, operationId: context.operationId,
    workspaceId: target.workspaceId, lineageIdentity: { formatVersion: 1, profileId: target.profileId },
    registryEntrySha256: target.registryEntrySha256 });
  const registryBeforeSha256 = createHash('sha256').update(beforeBytes).digest('hex');
  const entry = before.workspaces.find(value => value.workspaceId === header.workspaceId);
  if (registryBeforeSha256 !== target.registrySha256 || entry === undefined ||
      entry.lineageIdentity.profileId !== header.lineageIdentity.profileId ||
      workspaceRegistryEntrySha256(entry) !== header.registryEntrySha256 ||
      entry.workspaceLabel !== target.workspaceLabel || entry.lifecycleState !== target.lifecycleState) {
    return invalidDeletionData('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  }
  const after = removeWorkspaceEntry({ registry: before,
    expectedActiveWorkspaceId: target.previousActiveWorkspaceId, targetWorkspaceId: header.workspaceId });
  const registryAfterSha256 = createHash('sha256').update(serializeWorkspaceRegistry(after)).digest('hex');
  return Object.freeze({ before, after, target: header, registryBeforeSha256, registryAfterSha256 });
}
