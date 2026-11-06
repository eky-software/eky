import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { deriveProfileRestoreActivationOperationPaths } from '../../profileBackup/restore/profileRestoreActivationPaths.js';
import { deriveWorkspaceBackupReplacementPaths, deriveWorkspaceBackupReplacementOperationsPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';

// The optional workspace argument retains the existing callers' validation without inventing a target for shared roots.
export function deriveWorkspaceReplacementRemnantParents(userDataRoot: string, workspaceId?: string) {
  createWorkspaceDeletionJournalPaths(userDataRoot);
  if (workspaceId !== undefined) validateWorkspaceId(workspaceId);
  const paths = deriveWorkspaceBackupReplacementOperationsPaths(userDataRoot);
  return Object.freeze([
    { role: 'replacementImport' as const, parentPath: paths.importRoot },
    { role: 'activationStaging' as const, parentPath: paths.activationStagingRoot },
    { role: 'activationRollback' as const, parentPath: paths.activationRollbackRoot },
    { role: 'activationFailed' as const, parentPath: paths.activationFailedRoot },
  ].map(location => {
    const child = relative(userDataRoot, location.parentPath);
    if (isAbsolute(child) || child.length === 0 || child.split(sep).some(part => part === '..' || part.length === 0)) {
      return invalidDeletionData('WORKSPACE_REMNANT_BINDING_INVALID');
    }
    let current = userDataRoot;
    const ancestors = [current];
    for (const part of child.split(sep)) { current = join(current, part); ancestors.push(current); }
    return Object.freeze({ ...location, ancestors: Object.freeze(ancestors) });
  }));
}

export function deriveWorkspaceReplacementRemnantRoot(
  userDataRoot: string, workspaceId: string, operationId: string,
  role: ReturnType<typeof deriveWorkspaceReplacementRemnantParents>[number]['role'],
) {
  createWorkspaceDeletionJournalPaths(userDataRoot);
  const paths = deriveWorkspaceBackupReplacementPaths(userDataRoot,
    validateWorkspaceBackupReplacementOperationId(operationId), validateWorkspaceId(workspaceId));
  const activation = deriveProfileRestoreActivationOperationPaths({
    activeDatabasePath: paths.activeDatabasePath, activeDocumentsRoot: paths.activeArtifactRoot,
    failedRoot: paths.activationFailedRoot, rollbackRoot: paths.activationRollbackRoot, stagingRoot: paths.activationStagingRoot,
  }, operationId);
  const roots = { replacementImport: paths.importStagingRoot, activationStaging: activation.stagingOperationRoot,
    activationRollback: activation.rollbackOperationRoot, activationFailed: activation.failedOperationRoot };
  if (!Object.hasOwn(roots, role)) return invalidDeletionData('WORKSPACE_REMNANT_BINDING_INVALID');
  const rootPath = roots[role];
  return Object.freeze({ rootPath, parentPath: dirname(rootPath) });
}
