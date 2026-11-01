import { isAbsolute, join, relative, sep } from 'node:path';
import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { profileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';

// The runner's closed parent set; candidate-factory inspection-* copies are not these remnants.
export function deriveWorkspaceInspectionRemnantPaths(userDataRoot: string, value: unknown) {
  const binding = captureWorkspaceRemnantBinding(value);
  if (binding.owner !== 'profileInspection') return invalidDeletionData(invalidCode);
  const leaf = profileInspectionCopyDirectoryName(binding.generationId);
  return Object.freeze(deriveWorkspaceInspectionRemnantParents(userDataRoot, binding.workspaceId)
    .map(location => Object.freeze({ ...location, rootPath: join(location.parentPath, leaf) })));
}

// Independent parent observation must remain possible after a payloadless binding has been cleared.
export function deriveWorkspaceInspectionRemnantParents(userDataRoot: string, workspaceIdValue: string) {
  createWorkspaceDeletionJournalPaths(userDataRoot);
  const workspaceId = validateWorkspaceId(workspaceIdValue);
  const workspace = deriveWorkspaceRoot(userDataRoot, workspaceId, 1);
  const snapshot = createProfileSnapshotRuntimePaths(createDesktopProfilePaths(workspace.workspaceRoot).runtimeRoot);
  const replacement = deriveWorkspaceBackupReplacementRuntimePaths(userDataRoot, workspaceId);
  return Object.freeze([
    { scope: 'workspace', parentPath: snapshot.stagingRoot },
    { scope: 'workspace', parentPath: snapshot.restoreFailedRoot },
    { scope: 'replacement', parentPath: replacement.activationStagingRoot },
    { scope: 'replacement', parentPath: replacement.activationFailedRoot },
  ].map(location => {
    const child = relative(userDataRoot, location.parentPath);
    if (isAbsolute(child) || child.length === 0 || child.split(sep).some(part => part === '..' || part.length === 0)) {
      return invalidDeletionData(invalidCode);
    }
    let current = userDataRoot;
    const ancestors = [current];
    for (const part of child.split(sep)) { current = join(current, part); ancestors.push(current); }
    return Object.freeze({ ...location, ancestors: Object.freeze(ancestors) });
  }));
}
