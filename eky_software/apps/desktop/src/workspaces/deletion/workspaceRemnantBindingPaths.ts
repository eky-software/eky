import { join } from 'node:path';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';

const bindingDirectories = Object.freeze({
  workspaceReplacement: 'workspace-replacement-bindings',
  workspaceActivationMigration: 'workspace-activation-migration-bindings',
  workspaceImport: 'workspace-import-bindings',
  workspaceLegacyAdoption: 'workspace-legacy-adoption-bindings',
  profileInspection: 'profile-inspection-bindings',
});

export function createWorkspaceRemnantBindingPaths(userDataRoot: string, value: unknown) {
  const key = captureWorkspaceRemnantBindingKey(value);
  const state = createWorkspaceDeletionJournalPaths(userDataRoot);
  const directoryPath = join(state.directoryPath, bindingDirectories[key.owner]);
  const id = key.owner === 'workspaceLegacyAdoption' ? key.workspaceId
    : key.owner === 'profileInspection' ? `${key.operationId}-${key.generationId}` : key.operationId;
  const currentPath = join(directoryPath, `${id}.json`);
  return Object.freeze({ directoryPath, currentPath, nextPath: `${currentPath}.next`, backupPath: `${currentPath}.backup` });
}
