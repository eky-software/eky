import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { profileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryPayloadRecord,
  deletionInventoryRecordKey, type WorkspaceDeletionInventoryHeader,
  type WorkspaceDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { deriveWorkspaceInspectionRemnantParents } from './workspaceInspectionRemnantPaths.js';
import { deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';

const quarantinePrefix = '.workspace-delete-';
const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';

// These are candidates, not deletion authority. The persisted parent/root identities select exactly one.
export function deriveWorkspaceDeletionPayloadPaths(userDataRoot: string, targetValue: unknown, recordValue: unknown) {
  createWorkspaceDeletionJournalPaths(userDataRoot);
  const target = captureDeletionInventoryHeader(targetValue);
  const record = captureDeletionInventoryPayloadRecord(recordValue);
  const key = createHash('sha256').update(deletionInventoryRecordKey(record)).digest('hex');
  const quarantineName = `${quarantinePrefix}${target.operationId}-${key}`;
  return Object.freeze(sourcePaths(userDataRoot, target.workspaceId, record).map(sourcePath => {
    const parentPath = dirname(sourcePath);
    const child = relative(userDataRoot, parentPath);
    if (isAbsolute(child) || child.length === 0 || child.split(sep).some(part => part === '..' || part.length === 0)) {
      return invalidDeletionData(invalidCode);
    }
    let current = userDataRoot;
    const ancestors = [current];
    for (const part of child.split(sep)) { current = join(current, part); ancestors.push(current); }
    return Object.freeze({ sourcePath, parentPath, quarantinePath: join(parentPath, quarantineName),
      ancestors: Object.freeze(ancestors), legacyEntry: record.role === 'legacyEntry' });
  }));
}

export type WorkspaceDeletionPayloadPaths = ReturnType<typeof deriveWorkspaceDeletionPayloadPaths>[number];

function sourcePaths(root: string, workspaceId: WorkspaceDeletionInventoryHeader['workspaceId'],
  record: WorkspaceDeletionInventoryPayloadRecord): readonly string[] {
  switch (record.role) {
    case 'workspace': return [deriveWorkspaceRoot(root, workspaceId, 1).workspaceRoot];
    case 'legacyEntry': return [join(deriveWorkspaceLegacyRuntimePaths(root).legacyRuntimeRoot, record.member!)];
    case 'importCandidate':
    case 'adoptionCandidate': return [deriveWorkspaceBackupImportPaths(root,
      validateWorkspaceBackupImportOperationId(record.ownerOperationId), workspaceId).candidateRoot];
    case 'replacementImport':
    case 'activationStaging':
    case 'activationRollback':
    case 'activationFailed': return [deriveWorkspaceReplacementRemnantRoot(root, workspaceId, record.ownerOperationId!, record.role).rootPath];
    case 'inspection': return deriveWorkspaceInspectionRemnantParents(root, workspaceId)
      .filter(location => location.scope === 'replacement')
      .map(location => join(location.parentPath, profileInspectionCopyDirectoryName(record.generationId!)));
  }
}
