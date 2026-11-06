import { isAbsolute, join, relative, sep } from 'node:path';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryPayloadRecord, captureDeletionInventoryRecord, deletionInventoryLine } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { selectWorkspaceDeletionPayload } from './workspaceDeletionPayloadSelection.js';
import { workspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';
import { workspaceInspectionRemnantReads, type WorkspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import type { WorkspaceInspectionRemnantAuthority } from './workspaceInspectionRemnantObservation.js';
import { captureWorkspaceInspectionRemnantSource, projectWorkspaceInspectionRemnantInventoryRecord } from './workspaceInspectionRemnantSelection.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';

const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';

// Evidence follows its covering workspace; it never grants an additional move or deletion.
export async function assertWorkspaceDeletionInspectionEvidence(
  root: string, journalValue: unknown, workspaceValue: unknown, evidenceValue: unknown,
  authority: WorkspaceInspectionRemnantAuthority, reads: WorkspaceInspectionRemnantReads = workspaceInspectionRemnantReads,
): Promise<void> {
  const journal = captureWorkspaceDeletionJournal(journalValue);
  const workspace = captureDeletionInventoryPayloadRecord(workspaceValue), evidence = captureDeletionInventoryRecord(evidenceValue);
  if ((journal.phase !== 'authorized' && journal.phase !== 'quarantined') ||
      workspace.role !== 'workspace' || evidence.role !== 'inspectionEvidence') return invalidDeletionData(invalidCode);
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'profileInspection',
    operationId: evidence.ownerOperationId, generationId: evidence.generationId,
    workspaceId: journal.target.workspaceId, lineageIdentity: journal.target.lineageIdentity,
    rootIdentity: evidence.rootIdentity, parentIdentity: evidence.parentIdentity });
  if (workspaceRemnantBindingSha256(binding) !== evidence.bindingSha256) return invalidDeletionData(invalidCode);
  const guard = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority);
  const writersAbsent = authority.assertWritersAbsent.bind(authority);
  const directoryIdentity = reads.directoryIdentity.bind(reads), assertAbsent = reads.assertAbsent.bind(reads);
  guard(); await external(); guard();
  const selected = await selectWorkspaceDeletionPayload(root, journal, workspace, workspaceDeletionQuarantineFileSystem, guard, false);
  if (journal.phase === 'quarantined' && selected.state !== 'quarantine') return invalidDeletionData(invalidCode);
  const assertSelected = async () => {
    guard(); await external(); guard();
    await selected.assertState(selected.state); guard();
    await external(); guard();
  };
  const remap = (path: string) => {
    if (selected.state !== 'quarantine') return path;
    const child = relative(selected.paths.sourcePath, path);
    return isAbsolute(child) || child.split(sep).includes('..') ? path : join(selected.paths.quarantinePath, child);
  };
  await assertSelected();
  // Reuse the owner's four-location, binding-slot and source identity checks, changing only the proven root location.
  const source = await captureWorkspaceInspectionRemnantSource(root, binding, {
    assertAuthority: guard, assertExternalSelection: assertSelected,
    async assertWritersAbsent() { guard(); await writersAbsent(); guard(); },
  }, { reads: {
    directoryIdentity: (path, check) => directoryIdentity(remap(path), check),
    assertAbsent: (path, check) => assertAbsent(remap(path), check),
  } });
  const projected = projectWorkspaceInspectionRemnantInventoryRecord(root, journal.target, source, workspace);
  if (!deletionInventoryLine(projected).equals(deletionInventoryLine(evidence))) return invalidDeletionData(invalidCode);
  await source.assertSelected();
  await assertSelected();
  guard();
}
